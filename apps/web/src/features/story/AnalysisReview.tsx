import type { StoryAnalysis } from "@openmanga/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { del, patch, post } from "../../api/client.ts";
import { qk } from "../../api/hooks.ts";
import type { StoryAnalysisRow } from "../../api/types.ts";
import { ConfirmDialog, Field, Spinner, StatusChip, TagInput, toast } from "../../components/ui.tsx";
import { AnalysisDiff, NO_REMOVALS, type Removals, useAnalysisDiff } from "./AnalysisDiff.tsx";

type Char = StoryAnalysis["characters"][number];

/** Review + edit the structured analysis before it becomes cast/world/chapters. Nothing is applied until confirmed. */
export function AnalysisReview({
  analysis,
  projectId,
  onApplied,
}: {
  analysis: StoryAnalysisRow;
  projectId: string;
  onApplied?: (created: Record<string, number>) => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<StoryAnalysis | null>(analysis.result as StoryAnalysis | null);
  const [busy, setBusy] = useState<"save" | "apply" | null>(null);
  const [removals, setRemovals] = useState<Removals>(NO_REMOVALS);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setDraft(analysis.result as StoryAnalysis | null), [analysis.id, analysis.result]);
  useEffect(() => setRemovals(NO_REMOVALS), [analysis.id]);
  const diff = useAnalysisDiff(analysis.id, analysis.status !== "applied");
  if (!draft) return <p className="muted text-sm">此次分析没有结果。</p>;
  const applied = analysis.status === "applied";
  const set = <K extends keyof StoryAnalysis>(k: K, v: StoryAnalysis[K]) => setDraft({ ...draft, [k]: v });
  const setChar = (i: number, c: Partial<Char>) =>
    set(
      "characters",
      draft.characters.map((x, j) => (j === i ? { ...x, ...c } : x)),
    );
  const setBible = (i: number, b: Partial<Char["bible"]>) =>
    setChar(i, { bible: { ...draft.characters[i]!.bible, ...b } });

  const save = async () => {
    setBusy("save");
    try {
      await patch(`/story-analyses/${analysis.id}`, { result: draft });
      await qc.invalidateQueries({ queryKey: qk.story(projectId) });
      toast.success("已保存分析修改");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const ticked = Object.values(removals).flat().length;
  const apply = async () => {
    setConfirming(false);
    setBusy("apply");
    try {
      const r = await post<{ created: Record<string, number> }>(`/story-analyses/${analysis.id}/apply`, {
        result: draft,
      });
      // What the user confirmed removing goes through the ordinary delete routes, with their own safeguards (a
      // chapter with generation in progress is refused; cast and places go to the trash).
      const failed: string[] = [];
      for (const [kind, path] of [
        ["chapters", "chapters"],
        ["characters", "characters"],
        ["locations", "locations"],
        ["props", "props"],
      ] as const)
        for (const id of removals[kind]) await del(`/${path}/${id}`).catch((e) => failed.push(String(e?.message ?? e)));
      if (failed.length) toast.error(`有 ${failed.length} 项未能移除：${failed[0]}`);
      setRemovals(NO_REMOVALS);
      for (const key of [
        qk.story(projectId),
        qk.cast(projectId),
        qk.locations(projectId),
        qk.props(projectId),
        qk.chapters(projectId),
        qk.project(projectId),
        ["analysis-diff", analysis.id],
      ])
        await qc.invalidateQueries({ queryKey: key });
      toast.success(
        `已创建 ${r.created.characters} 个角色、${r.created.locations} 个场景、${r.created.props} 个道具和 ${r.created.chapters} 个章节`,
      );
      onApplied?.(r.created);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={analysis.status} />
        <span className="muted text-xs">可修改下方内容。应用后会创建可继续编辑的草稿，并复用已有的同名角色。</span>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn-secondary" onClick={save} disabled={busy !== null}>
            {busy === "save" && <Spinner />} 保存修改
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => (ticked ? setConfirming(true) : apply())}
            disabled={busy !== null}
          >
            {busy === "apply" ? <Spinner /> : <Check className="size-4" />} {applied ? "重新应用" : "应用到项目"}
          </button>
        </div>
      </div>

      {!applied && <AnalysisDiff analysisId={analysis.id} removals={removals} onRemovals={setRemovals} />}
      <ConfirmDialog
        open={confirming}
        title="应用分析并移除所选内容？"
        confirmLabel={`应用并移除 ${ticked} 项`}
        danger
        onClose={() => setConfirming(false)}
        onConfirm={() => void apply()}
      >
        <p className="mb-2">应用分析后将移除以下内容：</p>
        <ul className="list-inside list-disc text-sm">
          {diff.data?.chapters.removed
            .filter((c) => removals.chapters.includes(c.id))
            .map((c) => (
              <li key={c.id}>
                章节“{c.title}”及其 {c.pages} 页、{c.drawnPanels} 个已绘制的画格将一并删除
              </li>
            ))}
          {(["characters", "locations", "props"] as const).flatMap((k) =>
            (diff.data?.[k].removed ?? [])
              .filter((r) => removals[k].includes(r.id))
              .map((r) => <li key={r.id}>{r.name}及其参考图将移到回收站</li>),
          )}
        </ul>
      </ConfirmDialog>

      <section className="card space-y-3 p-4">
        <h3 className="font-medium">摘要</h3>
        <textarea
          className="input min-h-20"
          value={draft.summary}
          onChange={(e) => set("summary", e.target.value)}
          aria-label="摘要"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="题材">
            <input className="input" value={draft.genre} onChange={(e) => set("genre", e.target.value)} />
          </Field>
          <Field label="细分题材">
            <input className="input" value={draft.subgenre} onChange={(e) => set("subgenre", e.target.value)} />
          </Field>
          <Field label="基调">
            <input className="input" value={draft.tone} onChange={(e) => set("tone", e.target.value)} />
          </Field>
          <Field label="背景">
            <input className="input" value={draft.setting} onChange={(e) => set("setting", e.target.value)} />
          </Field>
          <Field label="时代">
            <input className="input" value={draft.period} onChange={(e) => set("period", e.target.value)} />
          </Field>
          <Field label="节奏">
            <input className="input" value={draft.pacing} onChange={(e) => set("pacing", e.target.value)} />
          </Field>
        </div>
        <Field label="主题">
          <TagInput value={draft.themes} onChange={(v) => set("themes", v)} />
        </Field>
        <Field label="视觉意象">
          <TagInput value={draft.visualMotifs} onChange={(v) => set("visualMotifs", v)} />
        </Field>
        <Field label="世界规则">
          <TagInput value={draft.world.worldRules} onChange={(v) => set("world", { ...draft.world, worldRules: v })} />
        </Field>
      </section>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-medium">角色（{draft.characters.length}）</h3>
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              set("characters", [
                ...draft.characters,
                {
                  key: `character-${draft.characters.length + 1}`,
                  name: "新角色",
                  aliases: [],
                  role: "supporting",
                  bible: draft.characters[0]?.bible
                    ? { ...draft.characters[0].bible, summary: "", immutableTraits: [], distinctiveFeatures: [] }
                    : ({} as Char["bible"]),
                },
              ])
            }
          >
            <Plus className="size-4" /> 添加
          </button>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {draft.characters.map((c, i) => (
            <div key={`${c.key}-${i}`} className="rounded-lg border border-[var(--border)] p-3">
              <div className="flex gap-2">
                <input
                  className="input font-medium"
                  value={c.name}
                  onChange={(e) => setChar(i, { name: e.target.value })}
                  aria-label="角色名称"
                />
                <select
                  className="input w-36"
                  value={c.role}
                  onChange={(e) => setChar(i, { role: e.target.value as Char["role"] })}
                  aria-label="角色定位"
                >
                  {Object.entries({
                    protagonist: "主角",
                    antagonist: "反派",
                    supporting: "配角",
                    minor: "次要角色",
                  }).map(([r, name]) => (
                    <option key={r} value={r}>
                      {name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-ghost text-red-500"
                  aria-label={`移除 ${c.name}`}
                  onClick={() =>
                    set(
                      "characters",
                      draft.characters.filter((_, j) => j !== i),
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <div className="mt-2 space-y-2">
                <Field label="别名（关联到此角色）">
                  <TagInput value={c.aliases} onChange={(v) => setChar(i, { aliases: v })} />
                </Field>
                <Field label="摘要">
                  <textarea
                    className="input min-h-14"
                    value={c.bible.summary}
                    onChange={(e) => setBible(i, { summary: e.target.value })}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="头发">
                    <input
                      className="input"
                      value={c.bible.hair}
                      onChange={(e) => setBible(i, { hair: e.target.value })}
                    />
                  </Field>
                  <Field label="眼睛">
                    <input
                      className="input"
                      value={c.bible.eyes}
                      onChange={(e) => setBible(i, { eyes: e.target.value })}
                    />
                  </Field>
                  <Field label="年龄">
                    <input
                      className="input"
                      value={c.bible.ageRange}
                      onChange={(e) => setBible(i, { ageRange: e.target.value })}
                    />
                  </Field>
                  <Field label="体型">
                    <input
                      className="input"
                      value={c.bible.build}
                      onChange={(e) => setBible(i, { build: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="服装">
                  <input
                    className="input"
                    value={c.bible.wardrobe}
                    onChange={(e) => setBible(i, { wardrobe: e.target.value })}
                  />
                </Field>
                <Field label="固定特征">
                  <TagInput value={c.bible.immutableTraits} onChange={(v) => setBible(i, { immutableTraits: v })} />
                </Field>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h3 className="mb-2 font-medium">场景（{draft.locations.length}）</h3>
          <ul className="space-y-2">
            {draft.locations.map((l, i) => (
              <li key={`${l.key}-${i}`} className="flex gap-2">
                <input
                  className="input"
                  value={l.name}
                  onChange={(e) =>
                    set(
                      "locations",
                      draft.locations.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                  aria-label="场景名称"
                />
                <button
                  type="button"
                  className="btn-ghost text-red-500"
                  aria-label={`移除 ${l.name}`}
                  onClick={() =>
                    set(
                      "locations",
                      draft.locations.filter((_, j) => j !== i),
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          <h3 className="mt-4 mb-2 font-medium">反复出现的道具</h3>
          <ul className="space-y-1 text-sm">
            {draft.props.map((p, i) => (
              <li key={`${p.key}-${i}`} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={p.recurring}
                  onChange={(e) =>
                    set(
                      "props",
                      draft.props.map((x, j) => (j === i ? { ...x, recurring: e.target.checked } : x)),
                    )
                  }
                  aria-label={`${p.name}是反复出现的道具`}
                />
                {p.name}
              </li>
            ))}
            {!draft.props.length && <li className="muted">未发现道具</li>}
          </ul>
        </div>
        <div className="card p-4">
          <h3 className="mb-2 font-medium">章节（{draft.chapters.length}）</h3>
          <ol className="space-y-2">
            {draft.chapters.map((c, i) => (
              <li key={i} className="space-y-1">
                <input
                  className="input font-medium"
                  value={c.title}
                  onChange={(e) =>
                    set(
                      "chapters",
                      draft.chapters.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                    )
                  }
                  aria-label="章节标题"
                />
                <p className="muted text-xs">{c.summary}</p>
              </li>
            ))}
          </ol>
          <h3 className="mt-4 mb-2 font-medium">主要情节节点</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {draft.plotBeats.map((b, i) => (
              <li key={i}>{b.summary}</li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
