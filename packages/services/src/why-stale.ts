import { type Database, sql } from "@openmanga/db";
import { IMPORTED_AUDIO_PROVIDER, splitParagraphs, stableStringify } from "@openmanga/domain";
import { type PipelineStage, pipelineStaleness, revisedStory } from "./staleness.ts";
import { chapterTrace } from "./trace.ts";

/** One out-of-date thing: what it is, what changed under it, and what bringing it up to date would redo. */
export type WhyItem = {
  label: string;
  why: string;
  redo: string;
  chapterId?: string;
  pageId?: string;
  panelId?: string;
};
export type WhyStage = { key: PipelineStage; items: WhyItem[]; more: number };

const CAP = 100;
const list = (xs: string[]) => xs.filter(Boolean).join("、");
const panelLabel = (page: number, panel: number) => `第 ${page} 页第 ${panel} 格`;
const fieldLabels = new Map(
  Object.entries({
    beat: "情节节点",
    shotType: "景别",
    cameraAngle: "机位角度",
    characters: "角色",
    locationId: "地点",
    composition: "构图",
    foreground: "前景",
    midground: "中景",
    background: "背景",
    lighting: "光线",
    emotion: "情绪",
    action: "动作",
    continuityRequirements: "连贯性要求",
    negativeSpace: "留白",
    propIds: "道具",
    dialogueIds: "对白",
    narrationIds: "旁白",
    sfxIds: "拟声词",
    height: "高度",
    seam: "衔接",
    direction: "镜头调度",
  }),
);

/**
 * Why each pipeline stage is out of date, item by item, along story revision → chapter plan → prompts → panel →
 * artwork → narration → audio → render: the dependency behind each count of the staleness report, and what an
 * update would redo for it. Read-only, except that a stale chapter planned before tracing existed is traced first.
 */
export async function whyStale(
  db: Database,
  project: { id: string; language: string; settings: { narrationVoice: string; narrationSpeed: number } },
): Promise<WhyStage[]> {
  const rows = <T>(q: ReturnType<typeof sql>) => db.execute<T & Record<string, unknown>>(q);
  const { stale } = await pipelineStaleness(db, project);
  const out: Record<PipelineStage, WhyItem[]> = {
    story: [],
    plan: [],
    prompts: [],
    art: [],
    narration: [],
    audio: [],
    render: [],
  };

  // Story: the newest revision against the one the applied analysis read, by paragraph.
  const revised = await revisedStory(db, project.id);
  if (revised) {
    const [r] = await rows<{ new_n: number; new_t: string; old_n: number | null; old_t: string | null }>(sql`
      select r.revision_number as new_n, r.content as new_t, o.revision_number as old_n, o.content as old_t
      from story_revisions r
      left join story_revisions o on o.id = (select a.story_revision_id from story_analyses a
        where a.project_id = ${project.id} and a.status = 'applied' order by a.applied_at desc nulls last limit 1)
      where r.id = ${revised}`);
    const was = new Set(splitParagraphs(r?.old_t ?? "").map((p) => p.text));
    const now = new Set(splitParagraphs(r?.new_t ?? "").map((p) => p.text));
    const added = [...now].filter((p) => !was.has(p)).length;
    const removed = [...was].filter((p) => !now.has(p)).length;
    out.story.push({
      label: `故事第 ${r?.new_n ?? "？"} 版`,
      why: `当前故事相比已分析的第 ${r?.old_n ?? "？"} 版有更新：${
        list([added ? `新增或修改 ${added} 段` : "", removed ? `删除或修改 ${removed} 段` : ""]) || "仅空白发生变化"
      }`,
      redo: "重新分析故事，审核后再应用变更",
    });
  }

  // Plan: chapters never planned, and chapters whose text changed after planning (with the panels it hits).
  for (const c of await rows<{ id: string; title: string }>(sql`
    select c.id, c.title from chapters c where c.project_id = ${project.id}
      and not exists (select 1 from pages p where p.chapter_id = c.id) order by c."order"`))
    out.plan.push({ label: c.title, chapterId: c.id, why: "尚未规划", redo: "规划章节，生成新页面和画格" });
  for (const c of stale.plans) {
    const t = await chapterTrace(db, c.chapterId, project.language);
    const hit = t?.panels.filter((p) => p.changed) ?? [];
    out.plan.push({
      label: c.title,
      chapterId: c.chapterId,
      why: hit.length
        ? `规划后原文已修改，涉及 ${hit.length} 个画格（${hit
            .slice(0, 6)
            .map((p) => panelLabel(p.page, p.panel))
            .join("、")}${hit.length > 6 ? "、……" : ""}）`
        : "规划后原文已修改，现有画格对应的原文片段仍相同",
      redo: `重新规划将替换 ${c.pages} 页和 ${c.drawnPanels} 个已绘制的画格。选择保留可将当前规划标为最新。`,
    });
  }

  // Prompts: pages with a panel still to draw and nothing prepared, per chapter.
  for (const c of await rows<{ id: string; title: string; pages: number }>(sql`
    select c.id, c.title, count(distinct p.id)::int as pages from chapters c
      join pages p on p.chapter_id = c.id join panels pn on pn.page_id = p.id
    where c.project_id = ${project.id} and pn.active_artwork_asset_id is null and pn.prompt_draft is null
    group by c.id order by min(c."order")`))
    out.prompts.push({
      label: c.title,
      chapterId: c.id,
      why: `${c.pages} 页包含待绘制的画格，但尚未准备提示词`,
      redo: `为每页准备提示词，共 ${c.pages} 次文本请求`,
    });

  // Art: undrawn panels per chapter, and each panel whose spec was edited after its artwork, with the fields.
  for (const c of await rows<{ id: string; title: string; k: number }>(sql`
    select c.id, c.title, count(*)::int as k from chapters c
      join pages p on p.chapter_id = c.id join panels pn on pn.page_id = p.id
    where c.project_id = ${project.id} and pn.active_artwork_asset_id is null
    group by c.id order by min(c."order")`))
    out.art.push({
      label: c.title,
      chapterId: c.id,
      why: `${c.k} 个画格尚未绘制`,
      redo: `绘制 ${c.k} 张图`,
    });
  for (const p of await rows<{
    id: string;
    page_id: string;
    chapter_id: string;
    title: string;
    page: number;
    panel: number;
    now: Record<string, unknown> | null;
    was: Record<string, unknown> | null;
  }>(sql`
    select pn.id, pn.page_id, c.id as chapter_id, c.title, pg."order" as page, pn."order" as panel,
      (select ps.spec from panel_specs ps where ps.panel_id = pn.id order by ps.version_number desc limit 1) as now,
      (select ps.spec from panel_specs ps where ps.panel_id = pn.id and ps.created_at <= a.created_at
        order by ps.version_number desc limit 1) as was
    from panels pn join assets a on a.id = pn.active_artwork_asset_id
      join pages pg on pg.id = pn.page_id join chapters c on c.id = pg.chapter_id
    where pn.project_id = ${project.id}
      and exists (select 1 from panel_specs ps where ps.panel_id = pn.id and ps.source = 'user'
                  and ps.created_at > a.created_at)
    order by c."order", pg."order", pn."order"`)) {
    const keys = [...new Set([...Object.keys(p.now ?? {}), ...Object.keys(p.was ?? {})])];
    const fields = keys.filter((k) => stableStringify(p.now?.[k]) !== stableStringify(p.was?.[k]));
    out.art.push({
      label: `${p.title} · ${panelLabel(p.page, p.panel)}`,
      chapterId: p.chapter_id,
      pageId: p.page_id,
      panelId: p.id,
      why: fields.length
        ? `绘制后修改了画格设定：${list(fields.slice(0, 8).map((field) => fieldLabels.get(field) ?? field))}${fields.length > 8 ? "、……" : ""}`
        : "绘制后重新保存了画格设定",
      redo: "重新绘制一张图，当前图片将保存在历史版本中",
    });
  }

  // Narration: chapters without it, and chapters whose panels or dialogue changed after it was written.
  for (const c of await rows<{ id: string; title: string }>(sql`
    select c.id, c.title from chapters c where c.project_id = ${project.id}
      and exists (select 1 from panels pn join pages p on p.id = pn.page_id where p.chapter_id = c.id)
      and not exists (select 1 from narration_lines nl where nl.chapter_id = c.id and nl.language = ${project.language})
    order by c."order"`))
    out.narration.push({
      label: c.title,
      chapterId: c.id,
      why: "已有画格，尚未编写旁白",
      redo: "编写旁白",
    });
  for (const c of stale.narration) {
    const touched = await rows<{ page: number; panel: number }>(sql`
      with w as (select max(created_at) as at from narration_lines
        where chapter_id = ${c.chapterId} and language = ${project.language})
      select p."order" as page, pn."order" as panel from panels pn join pages p on p.id = pn.page_id, w
      where p.chapter_id = ${c.chapterId} and (pn.created_at > w.at
        or exists (select 1 from panel_specs ps where ps.panel_id = pn.id and ps.created_at > w.at)
        or exists (select 1 from dialogue_lines d where d.panel_id = pn.id and d.updated_at > w.at))
      order by p."order", pn."order"`);
    out.narration.push({
      label: c.title,
      chapterId: c.chapterId,
      why: touched.length
        ? `编写旁白后修改了画格或对白：${touched
            .slice(0, 6)
            .map((t) => panelLabel(t.page, t.panel))
            .join("、")}${touched.length > 6 ? "、……" : ""}`
        : "编写旁白后删除、重新排序或跨页移动了画格",
      redo: `重写将替换 ${c.narrationLines} 条旁白及对应音频。选择保留可将当前旁白标为最新。`,
    });
  }

  // Audio: per chapter, segments without audio or with audio made from other text, voice or speed.
  const voice = project.settings.narrationVoice;
  const speed = project.settings.narrationSpeed;
  for (const c of await rows<{ id: string; title: string; none: number; text: number; voice: number; speed: number }>(
    sql`select c.id, c.title,
        count(*) filter (where a.asset_id is null)::int as none,
        count(*) filter (where a.asset_id is not null and a.text_sha256 <> s.text_sha256)::int as text,
        count(*) filter (where a.asset_id is not null and a.text_sha256 = s.text_sha256
          and a.provider <> ${IMPORTED_AUDIO_PROVIDER} and a.voice <> coalesce(s.voice, ${voice}))::int as voice,
        count(*) filter (where a.asset_id is not null and a.text_sha256 = s.text_sha256
          and a.provider <> ${IMPORTED_AUDIO_PROVIDER} and a.voice = coalesce(s.voice, ${voice})
          and abs(a.speed - coalesce(s.speed, ${speed})) > 0.001)::int as speed
      from narration_segments s
        join narration_lines nl on nl.id = s.narration_line_id
        join chapters c on c.id = nl.chapter_id
        left join audio_assets a on a.asset_id = s.active_audio_asset_id
      where nl.project_id = ${project.id} and nl.language = ${project.language}
      group by c.id order by min(c."order")`,
  )) {
    const k = c.none + c.text + c.voice + c.speed;
    if (!k) continue;
    out.audio.push({
      label: c.title,
      chapterId: c.id,
      why: list([
        c.none ? `${c.none} 条旁白缺少音频` : "",
        c.text ? `${c.text} 条旁白的文本或发音有更新` : "",
        c.voice ? `${c.voice} 条旁白使用了其他音色` : "",
        c.speed ? `${c.speed} 条旁白使用了其他语速` : "",
      ]),
      redo: `合成 ${k} 条旁白的音频`,
    });
  }

  // Render: what changed after the newest whole-project video.
  const [film] = await rows<{ at: string | null }>(sql`
    select max(j.created_at)::text as at from export_jobs j
    where j.project_id = ${project.id} and j.kind in ('video_pages', 'video_panels') and j.status = 'completed'
      and j.chapter_id is null and j.options -> 'pageIds' is null and j.options -> 'video' -> 'maxDurationMs' is null
      and exists (select 1 from exports e where e.export_job_id = j.id)`);
  if (!film?.at) out.render.push({ label: "视频", why: "尚未渲染整部视频", redo: "渲染整部视频" });
  else {
    const [ch] = await rows<Record<string, number>>(sql`
      select
        (select count(*)::int from panels where project_id = ${project.id} and updated_at > ${film.at}::timestamptz) as panels,
        (select count(*)::int from panels pn join assets a on a.id = pn.active_artwork_asset_id
          where pn.project_id = ${project.id} and a.created_at > ${film.at}::timestamptz) as artwork,
        (select count(*)::int from pages where project_id = ${project.id} and updated_at > ${film.at}::timestamptz) as pages,
        (select count(*)::int from narration_lines where project_id = ${project.id} and updated_at > ${film.at}::timestamptz) as narration,
        (select count(*)::int from narration_segments where project_id = ${project.id} and updated_at > ${film.at}::timestamptz) as audio,
        (select count(*)::int from dialogue_lines where project_id = ${project.id} and updated_at > ${film.at}::timestamptz) as dialogue,
        (select count(*)::int from sound_effects where project_id = ${project.id} and updated_at > ${film.at}::timestamptz) as sfx,
        (select count(*)::int from projects where id = ${project.id} and updated_at > ${film.at}::timestamptz) as settings`);
    const why = list([
      ch?.panels ? `编辑了 ${ch.panels} 个画格` : "",
      ch?.artwork ? `新增 ${ch.artwork} 张图` : "",
      ch?.pages ? `修改了 ${ch.pages} 页` : "",
      ch?.narration ? `修改了 ${ch.narration} 条旁白` : "",
      ch?.audio ? `修改了 ${ch.audio} 段音频` : "",
      ch?.dialogue ? `修改了 ${ch.dialogue} 条对白` : "",
      ch?.sfx ? `修改了 ${ch.sfx} 处拟声词` : "",
      ch?.settings ? "修改了项目设置" : "",
    ]);
    if (why)
      out.render.push({
        label: "视频",
        why: `最近一次渲染（${film.at.slice(0, 16)} UTC）后的变更：${why}`,
        redo: "重新渲染视频，未修改的片段将使用缓存",
      });
  }

  return (Object.keys(out) as PipelineStage[]).map((key) => ({
    key,
    items: out[key].slice(0, CAP),
    more: Math.max(0, out[key].length - CAP),
  }));
}
