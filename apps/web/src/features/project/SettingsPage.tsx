import {
  BUILTIN_LETTERING,
  MAX_AUTO_REGENERATIONS,
  resolveLettering,
  visualCheckModes,
} from "@openmanga/domain/browser";
import {
  type BubbleType,
  type LetteringDefaults,
  type LetteringStyle,
  type ProjectSettings,
  type SfxDefaults,
  VISUAL_CHECKS,
  type VisualCheck,
  type VisualCheckMode,
} from "@openmanga/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { get, patch, post } from "../../api/client.ts";
import { qk, useAction, useMeta } from "../../api/hooks.ts";
import type { ChapterListItem, TtsStatus } from "../../api/types.ts";
import {
  ConfirmDialog,
  Field,
  NumberInput,
  PageHeader,
  SaveIndicator,
  toast,
  useAutosave,
} from "../../components/ui.tsx";
import { projectTypeLabel } from "../../lib/locale.ts";
import { useAiOptions } from "../ai/AiPicker.tsx";
import { EdgePicker } from "../pages/EdgePicker.tsx";
import { LayoutLibrary } from "../pages/LayoutLibrary.tsx";
import { useProject, useProjectId } from "./ProjectLayout.tsx";
import { PronunciationSection } from "./PronunciationSection.tsx";
import { StorageSection } from "./StorageSection.tsx";
import { PublishingSection, VideoSection } from "./VideoSettings.tsx";

type Form = {
  title: string;
  description: string;
  projectType: string;
  language: string;
  readingDirection: string;
  colorMode: string;
  settings: ProjectSettings;
};

export function SettingsPage() {
  const projectId = useProjectId();
  const { data } = useProject();
  const qc = useQueryClient();
  const meta = useMeta();
  const navigate = useNavigate();
  const chapters = useQuery({
    queryKey: qk.chapters(projectId),
    queryFn: () => get<{ chapters: ChapterListItem[] }>(`/projects/${projectId}/chapters`),
    select: (r) => r.chapters,
  });
  const tts = useQuery({ queryKey: ["tts-status"], queryFn: () => get<TtsStatus>("/tts/status"), staleTime: 60_000 });
  const p = data?.project;
  const loaded: Form | null = p
    ? {
        title: p.title,
        description: p.description,
        projectType: p.projectType,
        language: p.language,
        readingDirection: p.readingDirection,
        colorMode: p.colorMode,
        settings: p.settings,
      }
    : null;
  const [form, setForm] = useState<Form | null>(loaded);
  const [confirm, setConfirm] = useState<null | "archive" | "trash">(null);
  const { state, markSaved } = useAutosave(
    form,
    async (v) => {
      if (!v) return;
      // The storage policy has its own save (and owner check), and the publishing text, repurpose plan and thumbnail
      // are written by their own screens and by jobs while this page is open: a copy from when it opened must not
      // put old values back. None is edited here.
      const { storage: _s, youtubePackage: _y, repurpose: _r, thumbnail: _t, ...settings } = v.settings;
      await patch(`/projects/${projectId}`, { ...v, settings });
      await qc.invalidateQueries({ queryKey: qk.project(projectId) });
    },
    { enabled: Boolean(form) && data?.role !== "viewer" },
  );
  useEffect(() => {
    if (loaded && !form) {
      // What the server has is saved already: opening the page is not an edit.
      markSaved(loaded);
      setForm(loaded);
    }
  }, [data, form]);
  if (!form || !data) return null;
  const owner = data.role === "owner" || data.role === "admin";
  const viewer = data.role === "viewer";
  const s = form.settings;
  const set = (k: keyof Form, v: string) => setForm({ ...form, [k]: v });
  const setS = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) =>
    setForm({ ...form, settings: { ...form.settings, [k]: v } });
  const num = (k: keyof ProjectSettings, min: number, max: number, step = 1) => (
    <input
      className="input"
      type="number"
      min={min}
      max={max}
      step={step}
      value={Number(s[k] ?? "")}
      onChange={(e) => e.target.value !== "" && setS(k, Number(e.target.value) as never)}
    />
  );
  const refDefault = meta.data?.referenceDefaults;
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <PageHeader
        title="项目设置"
        subtitle={viewer ? "仅可查看，无法修改此项目的设置。" : "修改后自动保存。"}
        actions={<SaveIndicator state={state} />}
      />
      {/* A viewer sees the settings but can't change them (nothing they type would be saved). */}
      <fieldset disabled={viewer} className="min-w-0 space-y-4">
        <section className="card grid gap-3 p-4 sm:grid-cols-2">
          <h2 className="font-medium sm:col-span-2">常规</h2>
          <Field label="标题">
            <input className="input" value={form.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label="作品语言">
            <input className="input" value={form.language} onChange={(e) => set("language", e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="简介">
              <textarea
                className="input min-h-16"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </Field>
          </div>
          <Field label="项目类型">
            <select className="input" value={form.projectType} onChange={(e) => set("projectType", e.target.value)}>
              {["manhwa", "manga", "webtoon", "comic", "illustrated_story"].map((t) => (
                <option key={t} value={t}>
                  {projectTypeLabel(t)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="阅读方向">
            <select
              className="input"
              value={form.readingDirection}
              onChange={(e) => set("readingDirection", e.target.value)}
            >
              <option value="ltr">从左到右</option>
              <option value="rtl">从右到左</option>
              <option value="vertical">竖向阅读</option>
            </select>
          </Field>
          <Field label="色彩模式" hint="此设置会加入生成提示词">
            <select className="input" value={form.colorMode} onChange={(e) => set("colorMode", e.target.value)}>
              <option value="full_color">彩色</option>
              <option value="grayscale">灰度</option>
              <option value="bw_manga">黑白漫画</option>
            </select>
          </Field>
          <Field label="作者（用于封面）">
            <input className="input" value={s.author} onChange={(e) => setS("author", e.target.value)} />
          </Field>
          <p className="muted text-xs sm:col-span-2">美术预设和风格参考在“世界设定 → 风格”中管理。</p>
        </section>

        <section className="card grid gap-3 p-4 sm:grid-cols-3">
          <h2 className="font-medium sm:col-span-3">{s.format === "film" ? "镜头与生成" : "页面与生成"}</h2>
          {s.format === "film" ? (
            <>
              <p className="muted text-sm sm:col-span-2">
                旁白视频项目中，每页是一个无边距的全画幅镜头，按镜头列表规划，并以 Ken Burns
                平移缩放效果导出。竖屏项目会按竖向画幅规划和绘制镜头，适用于 Shorts
                和手机，导出时无需裁切。已有页面后，项目形式和镜头画幅均无法更改。
              </p>
              <Field label="镜头画幅">
                <select
                  className="input"
                  value={s.filmFrame ?? "16:9"}
                  onChange={(e) => setS("filmFrame", e.target.value as "16:9" | "9:16")}
                >
                  <option value="16:9">16:9 横屏（1920×1080）</option>
                  <option value="9:16">9:16 竖屏（1080×1920）</option>
                </select>
              </Field>
            </>
          ) : (
            <>
              <Field label="默认页面宽度（像素）">{num("pageWidth", 256, 8000)}</Field>
              <Field label="默认页面高度（像素）">{num("pageHeight", 256, 20000)}</Field>
            </>
          )}
          <Field label="AI 预算上限（美元）" hint="本项目的支出达到上限后会暂停生成并请求确认。留空表示不设上限。">
            <input
              className="input"
              type="number"
              min={0}
              step={1}
              placeholder="不设上限"
              disabled={!owner}
              title={owner ? undefined : "只有项目所有者可以修改预算"}
              value={s.budgetUsd ?? ""}
              onChange={(e) => setS("budgetUsd", e.target.value === "" ? null : Math.max(0, Number(e.target.value)))}
            />
          </Field>
          <Field label="分镜生成质量" hint="默认使用低质量">
            <select
              className="input"
              value={s.imageQuality}
              onChange={(e) => setS("imageQuality", e.target.value as ProjectSettings["imageQuality"])}
            >
              <option value="low">低（推荐）</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </Field>
          {s.format !== "film" && (
            <>
              <Field label="页面边距（0–0.2）">{num("pageMargin", 0, 0.2, 0.005)}</Field>
              <Field label="分镜间距（0–0.1）">{num("pageGutter", 0, 0.1, 0.005)}</Field>
              <div />
            </>
          )}
          <Field label="参考图缩略副本最大宽度" hint={`服务器默认值 ${refDefault?.maxWidth ?? 192}`}>
            <input
              className="input"
              type="number"
              min={16}
              max={2048}
              placeholder={String(refDefault?.maxWidth ?? 192)}
              value={s.referenceMaxWidth ?? ""}
              onChange={(e) => setS("referenceMaxWidth", e.target.value ? Number(e.target.value) : undefined)}
            />
          </Field>
          <Field label="参考图缩略副本最大高度" hint={`服务器默认值 ${refDefault?.maxHeight ?? 288}`}>
            <input
              className="input"
              type="number"
              min={16}
              max={2048}
              placeholder={String(refDefault?.maxHeight ?? 288)}
              value={s.referenceMaxHeight ?? ""}
              onChange={(e) => setS("referenceMaxHeight", e.target.value ? Number(e.target.value) : undefined)}
            />
          </Field>
          <p className="muted text-xs sm:col-span-3">
            图像请求仅发送参考图的缩略副本，原始参考图保留完整分辨率。可调整尺寸，比较费用与一致性，详见“费用 →
            参考图尺寸实验”。
          </p>
        </section>

        <section className="card grid gap-3 p-4 sm:grid-cols-3">
          <h2 className="font-medium sm:col-span-3">旁白与条漫</h2>
          <Field label="旁白音色">
            <select className="input" value={s.narrationVoice} onChange={(e) => setS("narrationVoice", e.target.value)}>
              {(tts.data?.voices.length
                ? tts.data.voices
                : [{ id: s.narrationVoice, name: s.narrationVoice, language: "" }]
              ).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} {v.language && `(${v.language})`}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`旁白语速（${s.narrationSpeed.toFixed(2)}×）`}>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={s.narrationSpeed}
              onChange={(e) => setS("narrationSpeed", Number(e.target.value))}
              className="w-full"
            />
          </Field>
          <Field label="每格旁白词数" hint={`≈${Math.round(((s.narrationWordsPerPanel ?? 21) / 210) * 60)} 秒旁白／格`}>
            {num("narrationWordsPerPanel", 5, 80)}
          </Field>
          <Field label="旁白后停顿（毫秒）" hint="每段旁白后的静音时长">
            {num("narrationPauseMs", 0, 5000)}
          </Field>
          <Field label="场景／章节末停顿（毫秒）" hint="场景最后一句之后的较长停顿">
            {num("sceneBreakPauseMs", 0, 10000)}
          </Field>
          <Field label="旁白风格" hint="应用于所有章节，以保持旁白风格一致">
            <input
              className="input"
              maxLength={500}
              placeholder="例如冷峻、温暖、第二人称、现在时"
              value={s.narrationStyle ?? ""}
              onChange={(e) => setS("narrationStyle", e.target.value)}
            />
          </Field>
          <Field label="条漫宽度（像素）">{num("webtoonWidth", 320, 2000)}</Field>
          <Field label="条漫分镜间距（像素）">{num("webtoonGap", 0, 1000)}</Field>
          <Field label="条漫分段最大高度（像素）">{num("webtoonChunkHeight", 1000, 40000)}</Field>
        </section>

        <PronunciationSection
          value={s.pronunciation ?? []}
          voice={s.narrationVoice}
          speed={s.narrationSpeed}
          onChange={(v) => setS("pronunciation", v)}
        />

        <RuntimeSection
          projectId={projectId}
          saved={data.project.settings.targetRuntime ?? null}
          value={s.targetRuntime ?? null}
          onChange={(v) => setS("targetRuntime", v)}
        />

        {s.format !== "film" && s.format !== "vertical" && (
          <LayoutLibrary projectId={projectId} value={s.layouts} onChange={(v) => setS("layouts", v)} />
        )}

        <section className="card space-y-3 p-4">
          <h2 className="font-medium">页面与分镜边缘</h2>
          <p className="muted text-xs">
            为页面和分镜设置波浪、撕纸、粗切、笔触或烧灼边缘。页面和 PDF
            会将边缘绘制在纸面上，视频会沿此边缘裁出页面并叠放在模糊背景上。每个分镜可在“分镜”选项卡中单独选择边框。
          </p>
          <EdgePicker label="页面边缘" value={s.edges?.page} onChange={(page) => setS("edges", { ...s.edges, page })} />
          <EdgePicker
            label="分镜边框"
            value={s.edges?.panels}
            onChange={(panels) => setS("edges", { ...s.edges, panels })}
          />
        </section>

        <VideoSection
          logoUpload={`/projects/${projectId}/video-logo`}
          musicUpload={`/projects/${projectId}/video-music`}
          projectTitle={form.title}
          chapters={chapters.data}
          value={s.video}
          onChange={(v) => setS("video", v)}
        />

        <StorageSection projectId={projectId} owner={owner} />

        <PublishingSection value={s} onChange={(v) => setForm({ ...form, settings: { ...form.settings, ...v } })} />

        <section className="card space-y-3 p-4">
          <h2 className="font-medium">制作</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="批量生成的参考图" hint="仅主要内容会跳过次要角色，以及出场不足两格的场景和道具。">
              <select
                className="input"
                value={s.referencePolicy ?? "all"}
                onChange={(e) => setS("referencePolicy", e.target.value as ProjectSettings["referencePolicy"])}
              >
                <option value="all">全部</option>
                <option value="main">仅主要角色和重复出场的场景</option>
              </select>
            </Field>
            <Field
              label="制作任务的费用策略"
              hint="提供商批处理费用减半，最长需要 24 小时。仅 OpenAI 和 Google 密钥支持批处理，DeepSeek、Meta、OpenRouter 等始终立即执行。"
            >
              <select
                className="input"
                value={s.batchPolicy ?? "interactive"}
                onChange={(e) => setS("batchPolicy", e.target.value as ProjectSettings["batchPolicy"])}
              >
                <option value="interactive">全部立即执行</option>
                <option value="images">文本立即执行，图像批处理</option>
                <option value="hybrid">文本批处理，图像立即执行</option>
                <option value="cheapest">全部批处理（最省费用）</option>
              </select>
            </Field>
          </div>
          <SaveTemplate projectId={projectId} defaultName={data.project.title} />
          <SaveProfile projectId={projectId} defaultName={data.project.title} />
        </section>

        <LetteringSection value={s.lettering} onChange={(v) => setS("lettering", v)} />

        {/* The project's own keys, its budget and its fate are the owner's; members see the rest. */}
        {owner && (
          <>
            <ConsistencySection value={s.consistencyCheck} onChange={(v) => setS("consistencyCheck", v)} />

            <FallbackSection value={s.contentPolicyFallback} onChange={(v) => setS("contentPolicyFallback", v)} />

            <section className="card flex flex-wrap items-center gap-2 border-red-500/30 p-4">
              <h2 className="mr-auto font-medium">危险操作</h2>
              <button type="button" className="btn-secondary" onClick={() => setConfirm("archive")}>
                {data.project.status === "archived" ? "取消归档项目" : "归档项目"}
              </button>
              <button type="button" className="btn-danger" onClick={() => setConfirm("trash")}>
                移至回收站
              </button>
            </section>
          </>
        )}
      </fieldset>
      <ConfirmDialog
        open={confirm !== null}
        danger={confirm === "trash"}
        title={confirm === "trash" ? "将项目移至回收站？" : "更改归档状态？"}
        confirmLabel="确认"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            const action = confirm === "trash" ? "trash" : data.project.status === "archived" ? "unarchive" : "archive";
            await post(`/projects/${projectId}/status`, { action });
            await qc.invalidateQueries({ queryKey: ["projects"] });
            await qc.invalidateQueries({ queryKey: qk.project(projectId) });
            if (action === "trash") navigate({ to: "/" });
          } catch (e) {
            toast.error(e);
          }
          setConfirm(null);
        }}
      >
        {confirm === "trash"
          ? "项目将移至回收站，可在项目列表中恢复。"
          : "归档项目会从最近项目列表中隐藏，所有内容均完整保留。"}
      </ConfirmDialog>
    </div>
  );
}

const FONTS = ["Comic Neue", "DejaVu Sans"];
const TYPE_LABEL: Record<BubbleType, string> = {
  normal: "对话",
  thought: "心理活动",
  shout: "喊话",
  whisper: "低语",
  narration: "旁白／说明",
  system: "系统框",
};

export function LetteringSection({
  value,
  onChange,
}: {
  value: LetteringDefaults | undefined;
  onChange: (v: LetteringDefaults) => void;
}) {
  const l = resolveLettering({ lettering: value });
  const cur = value ?? {};
  const setType = (t: BubbleType, p: Partial<LetteringStyle>) =>
    onChange({ ...cur, types: { ...cur.types, [t]: { ...cur.types?.[t], ...p } } });
  const setSfx = (p: Partial<SfxDefaults>) => onChange({ ...cur, sfx: { ...cur.sfx, ...p } });
  const n = (v: number, set: (v: number) => void, min: number, max: number, step = 1, label = "") => (
    <NumberInput
      className="input w-16 px-1 text-xs"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={v}
      onChange={set}
    />
  );
  const font = (v: string, set: (v: string) => void, label: string) => (
    <select className="input w-auto text-xs" aria-label={label} value={v} onChange={(e) => set(e.target.value)}>
      {FONTS.map((f) => (
        <option key={f}>{f}</option>
      ))}
    </select>
  );
  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-medium">文字默认样式</h2>
        <button type="button" className="btn-ghost text-xs" onClick={() => onChange({})}>
          恢复内置样式
        </button>
      </div>
      <p className="muted text-xs">
        用于新建的气泡、说明框和拟声词，也适用于 AI 规划的章节。字号以页面像素为单位，页面通常宽 1024–1600
        像素。要更新已有文字，请使用“编辑器 → 文字 → 默认样式”。
      </p>
      <label className="flex items-start gap-2 rounded-lg border border-[var(--border)] p-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={l.autoPlace}
          onChange={(e) => onChange({ ...cur, autoPlace: e.target.checked })}
        />
        <span>
          规划章节时自动添加对话气泡、说明框和拟声词
          <span className="muted block text-xs">
            关闭后，页面仅生成画面，分镜提示词不再为文字预留空间。规划中的对话和拟声词仍会保留，之后可使用“编辑器 → 文字
            → 从规划排字”添加。用于音频的旁白文本仍会生成。
          </span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={l.autoFit}
            onChange={(e) => onChange({ ...cur, autoFit: e.target.checked })}
          />
          文本框自动适应文字
        </label>
        <span className="flex items-center gap-2">
          文本框最大宽度（占页面百分比）
          {n(
            Math.round(l.maxWidth * 100),
            (v) => onChange({ ...cur, maxWidth: v / 100 }),
            10,
            100,
            1,
            "文本框最大宽度",
          )}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="muted text-left">
            <tr>
              <th className="py-1 pr-2 font-normal">类型</th>
              <th className="pr-2 font-normal">字体</th>
              <th className="pr-2 font-normal">字号</th>
              <th className="pr-2 font-normal">行高</th>
              <th className="pr-2 font-normal">内边距</th>
              <th className="pr-2 font-normal">对齐</th>
              <th className="pr-2 font-normal">填充</th>
              <th className="pr-2 font-normal">文字</th>
              <th className="pr-2 font-normal">边框</th>
              <th className="font-normal">边框宽度</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(BUILTIN_LETTERING.types) as BubbleType[]).map((t) => {
              const st = l.types[t];
              const lbl = TYPE_LABEL[t];
              return (
                <tr key={t} className="border-t border-[var(--border)]">
                  <td className="py-1 pr-2 whitespace-nowrap">{lbl}</td>
                  <td className="pr-2">{font(st.font, (font) => setType(t, { font }), `${lbl}字体`)}</td>
                  <td className="pr-2">
                    {n(st.fontSize, (fontSize) => setType(t, { fontSize }), 8, 200, 1, `${lbl}字号`)}
                  </td>
                  <td className="pr-2">
                    {n(st.lineHeight, (lineHeight) => setType(t, { lineHeight }), 0.8, 3, 0.05, `${lbl}行高`)}
                  </td>
                  <td className="pr-2">
                    {n(st.padding, (padding) => setType(t, { padding }), 0, 200, 1, `${lbl}内边距`)}
                  </td>
                  <td className="pr-2">
                    <select
                      className="input text-xs"
                      aria-label={`${lbl}对齐`}
                      value={st.align}
                      onChange={(e) => setType(t, { align: e.target.value as LetteringStyle["align"] })}
                    >
                      <option value="left">左对齐</option>
                      <option value="center">居中</option>
                      <option value="right">右对齐</option>
                    </select>
                  </td>
                  <td className="pr-2">
                    <input
                      type="color"
                      aria-label={`${lbl}填充色`}
                      value={st.background}
                      onChange={(e) => setType(t, { background: e.target.value })}
                    />
                  </td>
                  <td className="pr-2">
                    <input
                      type="color"
                      aria-label={`${lbl}文字颜色`}
                      value={st.textColor}
                      onChange={(e) => setType(t, { textColor: e.target.value })}
                    />
                  </td>
                  <td className="pr-2">
                    <input
                      type="color"
                      aria-label={`${lbl}边框颜色`}
                      value={st.borderColor}
                      onChange={(e) => setType(t, { borderColor: e.target.value })}
                    />
                  </td>
                  <td>{n(st.borderWidth, (borderWidth) => setType(t, { borderWidth }), 0, 20, 1, `${lbl}边框宽度`)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-3 text-xs">
        <span className="font-medium">拟声词</span>
        {font(l.sfx.font, (f) => setSfx({ font: f }), "拟声词字体")}
        <span className="flex items-center gap-1">
          字号 {n(l.sfx.fontSize, (fontSize) => setSfx({ fontSize }), 8, 400, 1, "拟声词字号")}
        </span>
        <label className="flex items-center gap-1">
          填充 <input type="color" value={l.sfx.fill} onChange={(e) => setSfx({ fill: e.target.value })} />
        </label>
        <label className="flex items-center gap-1">
          描边 <input type="color" value={l.sfx.stroke} onChange={(e) => setSfx({ stroke: e.target.value })} />
        </label>
        <span className="flex items-center gap-1">
          描边宽度 {n(l.sfx.strokeWidth, (strokeWidth) => setSfx({ strokeWidth }), 0, 30, 1, "拟声词描边宽度")}
        </span>
      </div>
    </section>
  );
}

/** Opt-in vision QA after each panel generation. Needs a vision-capable model from a saved key. */
function FallbackSection({
  value,
  onChange,
}: {
  value: ProjectSettings["contentPolicyFallback"];
  onChange: (v: NonNullable<ProjectSettings["contentPolicyFallback"]>) => void;
}) {
  const opts = useAiOptions();
  const cur = {
    enabled: true,
    credentialId: null as string | null,
    provider: null as string | null,
    model: "",
    ...value,
  };
  const creds = (opts.data?.credentials ?? []).filter((c) =>
    ["openai", "google", "meta", "openrouter", "openai_compatible"].includes(c.kind),
  );
  const selected = cur.credentialId ?? "";
  return (
    <section className="card space-y-3 p-4">
      <h2 className="font-medium">内容过滤备用方案</h2>
      <p className="muted text-xs">
        图像提供商因内容过滤拦截分镜时，使用你的另一个密钥重试一次，并将分镜标记为“待审核”。仅内容过滤拦截会触发切换，其他失败不会切换提供商。重试后画面可能略有变化，因此需要审核。请在下方选择密钥，此服务器没有共享密钥。
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={cur.enabled}
          onChange={(e) => onChange({ ...cur, enabled: e.target.checked })}
        />
        使用备用提供商重试被拦截的分镜一次
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="备用提供商">
          <select
            className="input"
            value={selected}
            onChange={(e) => onChange({ ...cur, credentialId: e.target.value || null, provider: null, model: "" })}
          >
            <option value="">选择你的一个密钥…</option>
            {creds.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} {c.keyHint}
              </option>
            ))}
          </select>
        </Field>
        <Field label="模型">
          <input
            className="input"
            placeholder="提供商默认模型"
            value={cur.model}
            onChange={(e) => onChange({ ...cur, model: e.target.value })}
          />
        </Field>
      </div>
    </section>
  );
}

const CHECK_LABEL: Record<VisualCheck, string> = {
  headcount: "角色与人数",
  identity: "人物身份",
  outfit: "服装",
  props: "道具",
  location: "场景",
  expression: "表情",
  pose: "姿势（严格参考）",
  framing: "构图",
  anatomy: "人体结构",
  text: "多余文字",
  style: "画风偏移",
  palette: "色彩偏移",
  covered_faces: "文字遮挡面部",
};
const CHECK_HINT: Record<VisualCheck, string> = {
  headcount: "应出场的角色均已出现，且没有多余人物",
  identity: "面部、发型与体型符合角色设定",
  outfit: "每个角色穿着分镜要求的服装",
  props: "分镜中的道具清晰可见，外观符合描述",
  location: "背景符合分镜指定的场景",
  expression: "面部呈现分镜要求的表情",
  pose: "人物姿势遵循严格布局参考，没有此参考的分镜会跳过检查",
  framing: "景别与视角符合规划",
  anatomy: "肢体、手和手指没有多余、缺失或结构错误",
  text: "画面中没有绘入字母或文字",
  style: "画面保持项目指定的画风",
  palette: "色彩符合项目指定的色彩模式",
  covered_faces: "气泡或说明框遮住面部，仅标记，可移动文字修复",
};

function ConsistencySection({
  value,
  onChange,
}: {
  value: ProjectSettings["consistencyCheck"];
  onChange: (v: NonNullable<ProjectSettings["consistencyCheck"]>) => void;
}) {
  const opts = useAiOptions();
  const cur = {
    enabled: false,
    credentialId: null as string | null,
    model: "",
    checks: {} as Partial<Record<VisualCheck, VisualCheckMode>>,
    autoFixBudgetUsd: 2,
    ...value,
  };
  const modes = visualCheckModes(cur.checks);
  const creds = (opts.data?.credentials ?? []).filter((c) =>
    ["openai", "anthropic", "google", "meta", "openrouter", "openai_compatible"].includes(c.kind),
  );
  return (
    <section className="card space-y-3 p-4">
      <h2 className="font-medium">画面检查（视觉质检）</h2>
      <p className="muted text-xs">
        每格生成后，由视觉模型检查画面中的角色、人数及下方启用的各项内容。不通过的分镜会在页面和编辑器中标记，或自动重绘。所有检查合并为一次额外的文本模型调用，并附带缩略图。请选择支持图像输入的模型密钥，例如
        OpenAI gpt-5-mini、Anthropic Claude、Google Gemini 或 Meta Muse。
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={cur.enabled}
          onChange={(e) => onChange({ ...cur, enabled: e.target.checked })}
        />
        自动检查每个生成的分镜
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="视觉模型提供商">
          <select
            className="input"
            value={cur.credentialId ?? ""}
            onChange={(e) => onChange({ ...cur, credentialId: e.target.value || null })}
          >
            <option value="">选择你的一个密钥…</option>
            {creds.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} {c.keyHint}
              </option>
            ))}
          </select>
        </Field>
        <Field label="模型">
          <input
            className="input"
            placeholder="例如 gpt-5-mini"
            value={cur.model}
            onChange={(e) => onChange({ ...cur, model: e.target.value })}
          />
        </Field>
      </div>
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {VISUAL_CHECKS.map((k) => (
          <label key={k} className="flex items-center justify-between gap-2 text-sm" title={CHECK_HINT[k]}>
            <span>{CHECK_LABEL[k]}</span>
            <select
              className="input w-44 py-1 text-xs"
              aria-label={`${CHECK_LABEL[k]}检查`}
              value={modes[k]}
              onChange={(e) => onChange({ ...cur, checks: { ...cur.checks, [k]: e.target.value as VisualCheckMode } })}
            >
              <option value="off">关闭</option>
              <option value="flag">仅标记</option>
              {/* Moving the lettering fixes a covered face; drawing the panel again does not. */}
              {k !== "covered_faces" && <option value="regenerate_once">重新生成一次</option>}
              {k !== "covered_faces" && <option value="regenerate_budget">在预算内反复生成</option>}
            </select>
          </label>
        ))}
      </div>
      <Field label="自动重绘预算（美元，整个项目）">
        <input
          className="input w-32"
          type="number"
          min={0}
          step={0.5}
          value={cur.autoFixBudgetUsd}
          onChange={(e) => onChange({ ...cur, autoFixBudgetUsd: Math.max(0, Number(e.target.value) || 0) })}
        />
      </Field>
      <p className="muted text-xs">
        “在预算内反复生成”会在自动重绘费用低于此预算时重绘未通过的分镜，直到通过，最多连续重绘 {MAX_AUTO_REGENERATIONS}{" "}
        次。项目总预算限制仍然生效。
      </p>
      {!creds.length ? (
        <p className="text-xs text-amber-600">请先在“账户 → AI 提供商”中添加支持视觉模型的 API 密钥。</p>
      ) : (
        cur.enabled && !cur.credentialId && <p className="text-xs text-amber-600">请在上方选择密钥，否则会跳过检查。</p>
      )}
    </section>
  );
}

type Runtime = NonNullable<ProjectSettings["targetRuntime"]>;
type RuntimeReport = {
  totalWords: number | null;
  neededChapters: number | null;
  estimatedMinutes: number;
  chapters: {
    id: string;
    order: number;
    title: string;
    budget: { words: number; shots: number; pages: number; capped: boolean } | null;
    planned: { pages: number; panels: number };
    narrationWords: number;
    estimatedMinutes: number;
  }[];
};

/**
 * 目标时长: a length to aim for. Chapter plans then default to a page count, and narration to words per
 * panel, that land each chapter on its share; the table compares that budget with what exists so far.
 */
function RuntimeSection({
  projectId,
  saved,
  value,
  onChange,
}: {
  projectId: string;
  saved: Runtime | null;
  value: Runtime | null;
  onChange: (v: Runtime | null) => void;
}) {
  // Keyed on the saved target, so the table refreshes once an edit has been autosaved.
  const report = useQuery({
    queryKey: ["project", projectId, "runtime", JSON.stringify(saved)],
    queryFn: () => get<RuntimeReport>(`/projects/${projectId}/runtime`),
  });
  const set = (p: Partial<Runtime>) => value && onChange({ ...value, ...p });
  const n = (k: keyof Runtime, min: number, max: number, step = 1) => (
    <input
      className="input"
      type="number"
      min={min}
      max={max}
      step={step}
      value={value?.[k] ?? ""}
      onChange={(e) => e.target.value !== "" && set({ [k]: Number(e.target.value) })}
    />
  );
  return (
    <section className="card space-y-3 p-4">
      <h2 className="font-medium">目标时长</h2>
      <p className="muted text-xs">
        设置视频的目标时长后，章节规划会按原文长度分配页面数和每格旁白词数。每个镜头的时长会保持在下方设置的最短和最长时长之间。
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) =>
            onChange(
              e.target.checked ? { minutes: 30, wordsPerMinute: 150, minShotSeconds: 4, maxShotSeconds: 8 } : null,
            )
          }
        />
        启用目标时长
      </label>
      {value && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="分钟">{n("minutes", 1, 600)}</Field>
          <Field label="每分钟词数" hint="平缓旁白约为每分钟 150 词">
            {n("wordsPerMinute", 80, 260)}
          </Field>
          <Field label="最短镜头（秒）">{n("minShotSeconds", 1, 30, 0.5)}</Field>
          <Field label="最长镜头（秒）">{n("maxShotSeconds", 2, 60, 0.5)}</Field>
        </div>
      )}
      {report.data && report.data.chapters.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="muted">
              <tr>
                <th className="py-1 pr-2">章节</th>
                {saved && <th className="py-1 pr-2">预算</th>}
                <th className="py-1 pr-2">已规划</th>
                <th className="py-1 pr-2">旁白</th>
              </tr>
            </thead>
            <tbody>
              {report.data.chapters.map((c) => (
                <tr key={c.id} className="border-t border-[var(--border)]">
                  <td className="max-w-48 truncate py-1 pr-2">
                    {c.order}. {c.title}
                  </td>
                  {saved && (
                    <td className="py-1 pr-2">
                      {c.budget ? `${c.budget.words} 词 · ${c.budget.shots} 个镜头 · ${c.budget.pages} 页` : "—"}
                      {c.budget?.capped && (
                        <span className="block text-amber-600" title="一个章节规划最多容纳 60 页">
                          超出单次规划容量，请拆分本章或延长镜头时长
                        </span>
                      )}
                    </td>
                  )}
                  <td className="py-1 pr-2">
                    {c.planned.pages} 页 · {c.planned.panels} 格
                  </td>
                  <td className="py-1 pr-2">
                    {c.narrationWords} 词 · 约 {c.estimatedMinutes} 分钟
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.data.neededChapters && report.data.chapters.length < report.data.neededChapters && (
            <p className="mt-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
              此时长约需 {report.data.neededChapters} 章，才能让每章符合单次规划容量；本项目目前有{" "}
              {report.data.chapters.length} 章。请重新分析故事以按目标章节数规划、拆分较长章节，或延长镜头时长。
            </p>
          )}
          <p className="muted mt-2 text-xs">
            当前旁白累计约 <strong>{report.data.estimatedMinutes} 分钟</strong>
            {saved ? `，目标为 ${saved.minutes} 分钟` : ""}.
          </p>
        </div>
      )}
    </section>
  );
}

/** Save this project's setup as a template for new projects (the story, cast and files stay here). */
function SaveTemplate({ projectId, defaultName }: { projectId: string; defaultName: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-3">
      <Field label="另存为模板" hint="保存类型、形式、风格和设置，供新项目使用。">
        <input className="input" placeholder={defaultName} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <button
        type="button"
        className="btn-secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await post(`/projects/${projectId}/template`, { name: name.trim() || defaultName });
            await qc.invalidateQueries({ queryKey: ["production-presets"] });
            toast.success("模板已保存，新建项目时可以选用。");
            setName("");
          } catch (e) {
            toast.error(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        保存模板
      </button>
    </div>
  );
}

/** Save this project's channel settings as a channel profile: its voice, look, branding and rules, not its setup. */
function SaveProfile({ projectId, defaultName }: { projectId: string; defaultName: string }) {
  const [name, setName] = useState("");
  const save = useAction(() => post(`/projects/${projectId}/channel-profile`, { name: name.trim() || defaultName }), {
    invalidate: [["channel-profiles"]],
    success: "频道配置已保存，可在频道配置中编辑，或用它创建新项目。",
    onSuccess: () => setName(""),
  });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="另存为频道配置" hint="保存音色、质量、时长、视频品牌与标志、缩略图与 YouTube 规则及导出画幅。">
        <input className="input" placeholder={defaultName} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <button type="button" className="btn-secondary" disabled={save.isPending} onClick={() => save.mutate()}>
        保存频道配置
      </button>
    </div>
  );
}
