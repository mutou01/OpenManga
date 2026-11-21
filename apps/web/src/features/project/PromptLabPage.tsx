import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { get, post } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import type { ChapterListItem } from "../../api/types.ts";
import { clsx, ErrorBox, Field, fmt, PageHeader, Spinner } from "../../components/ui.tsx";
import { useProjectId } from "./ProjectLayout.tsx";

type Version = { id: string; version: number; note: string; active: boolean; createdAt: string };
type Template = {
  name: string;
  label: string;
  image: boolean;
  builtInVersion: number;
  builtInRules: string;
  active: (Version & { rules: string }) | null;
  versions: Version[];
};
type Diff = { op: "same" | "add" | "remove"; line: string }[];

const TEMPLATE_LABELS: Readonly<Record<string, string>> = {
  "chapter-outline": "章节规划的场景大纲",
  "scene-pages": "章节规划的场景页面与分镜",
  "strip-outline": "条漫规划的场景大纲",
  "scene-strip": "条漫规划的场景分镜",
  "shot-outline": "镜头规划的场景大纲",
  "scene-shots": "镜头规划的场景镜头",
  "vertical-shot-outline": "竖屏镜头规划的场景大纲",
  "vertical-scene-shots": "竖屏镜头规划的场景镜头",
  "panel-prompts": "分镜提示词（文本模型生成的段落）",
  narration: "旁白指令",
  "panel-generation": "分镜图像的项目规则与排除项",
};

const templateLabel = (t: Template) => (Object.hasOwn(TEMPLATE_LABELS, t.name) ? TEMPLATE_LABELS[t.name] : t.label);

/**
 * The prompt lab: rewrite a built-in prompt's rules for this project (planning, panel prompts, narration; extra
 * rules for panel images), see the diff and the compiled prompt, keep versions and go back to any of them.
 */
export function PromptLabPage() {
  const projectId = useProjectId();
  const key = ["project", projectId, "prompt-lab"];
  const q = useQuery({
    queryKey: key,
    queryFn: () => get<{ templates: Template[] }>(`/projects/${projectId}/prompt-lab`),
  });
  const [name, setName] = useState<string | null>(null);
  const t = q.data?.templates.find((x) => x.name === (name ?? q.data?.templates[0]?.name));
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <PageHeader
        title="提示词实验室"
        subtitle="为此项目改写内置提示词的规则。故事内容仍作为数据，回答格式保持固定，每个任务都会记录所使用的版本。"
      />
      {q.isLoading && <Spinner />}
      <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      {q.data && (
        <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
          <ul className="space-y-1" aria-label="提示词列表">
            {q.data.templates.map((x) => (
              <li key={x.name}>
                <button
                  type="button"
                  onClick={() => setName(x.name)}
                  className={clsx(
                    "w-full rounded-lg border p-2 text-left text-sm",
                    x.name === t?.name ? "border-accent-500 bg-[var(--panel-2)]" : "border-[var(--border)]",
                  )}
                >
                  <div className="font-medium">{templateLabel(x)}</div>
                  <div className="muted text-xs">
                    {x.active ? `项目规则 v${x.active.version}` : `内置 v${x.builtInVersion}`}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {t && <Editor key={`${t.name}-${t.active?.version ?? 0}`} projectId={projectId} t={t} invalidate={key} />}
        </div>
      )}
    </div>
  );
}

function Editor({ projectId, t, invalidate }: { projectId: string; t: Template; invalidate: unknown[] }) {
  const qc = useQueryClient();
  const [rules, setRules] = useState(t.active?.rules ?? t.builtInRules);
  const [note, setNote] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [panelIds, setPanelIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<{
    system?: string;
    panels?: { panelId: string; prompt: string }[];
    diff: Diff;
  } | null>(null);
  const chapters = useQuery({
    queryKey: qk.chapters(projectId),
    queryFn: () => get<{ chapters: ChapterListItem[] }>(`/projects/${projectId}/chapters`),
    select: (r) => r.chapters,
    enabled: t.image,
  });
  const panels = useQuery({
    queryKey: ["chapter", chapterId, "panels"],
    queryFn: () =>
      get<{ panels: { id: string; order: number; pageOrder: number; storyBeat: string }[] }>(
        `/chapters/${chapterId}/panels`,
      ),
    select: (r) => r.panels,
    enabled: t.image && Boolean(chapterId),
  });
  const done = () => void qc.invalidateQueries({ queryKey: invalidate });
  const run = useAction(
    () => post<NonNullable<typeof preview>>(`/projects/${projectId}/prompt-lab/${t.name}/preview`, { rules, panelIds }),
    { onSuccess: setPreview },
  );
  const save = useAction(() => post(`/projects/${projectId}/prompt-lab/${t.name}`, { rules, note }), {
    success: "已保存并在本项目中启用",
    onSuccess: done,
  });
  const activate = useAction(
    (version: number) => post(`/projects/${projectId}/prompt-lab/${t.name}/activate`, { version }),
    {
      success: (_r) => "已切换",
      onSuccess: done,
    },
  );
  return (
    <section className="space-y-3" aria-label={templateLabel(t)}>
      <Field
        label={t.image ? "每个分镜图像提示词附加的项目规则" : "规则"}
        hint={
          t.image
            ? "补充要求和排除项，例如“画面不出现血迹”或“天空始终阴沉”。"
            : `以内置 v${t.builtInVersion} 的规则为起点。模板头、数据规则和回答格式会自动添加。`
        }
      >
        <textarea
          className="input min-h-72 font-mono text-xs"
          value={rules}
          onChange={(e) => setRules(e.target.value)}
        />
      </Field>
      {t.image && (
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <Field label="选择章节中的分镜试用">
            <select
              className="input"
              value={chapterId}
              onChange={(e) => {
                setChapterId(e.target.value);
                setPanelIds([]);
              }}
            >
              <option value="">选择章节…</option>
              {chapters.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  第 {c.order} 章 · {c.title}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex max-h-24 flex-wrap gap-1 overflow-auto">
            {panels.data?.map((p) => (
              <label key={p.id} className="chip cursor-pointer text-xs">
                <input
                  type="checkbox"
                  className="mr-1"
                  checked={panelIds.includes(p.id)}
                  disabled={!panelIds.includes(p.id) && panelIds.length >= 3}
                  onChange={(e) =>
                    setPanelIds((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id)))
                  }
                />
                第 {p.pageOrder} 页 · 第 {p.order} 格
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={run.isPending || (t.image && !panelIds.length)}
          onClick={() => run.mutate()}
        >
          预览
        </button>
        <input className="input w-60" placeholder="本版本备注" value={note} onChange={(e) => setNote(e.target.value)} />
        <button
          type="button"
          className="btn-primary"
          disabled={save.isPending || !rules.trim()}
          onClick={() => save.mutate()}
        >
          另存为 v{(t.versions[0]?.version ?? 0) + 1} 并启用
        </button>
      </div>
      {preview && (
        <div className="grid gap-3 lg:grid-cols-2">
          <section aria-label="差异">
            <div className="label">相对内置版本的改动</div>
            <pre className="max-h-80 overflow-auto rounded-lg border border-[var(--border)] p-2 text-[11px] whitespace-pre-wrap">
              {preview.diff
                .filter((d) => d.op !== "same")
                .map((d, i) => (
                  <div key={i} className={d.op === "add" ? "text-emerald-600" : "text-red-500 line-through"}>
                    {d.op === "add" ? "+ " : "- "}
                    {d.line}
                  </div>
                ))}
              {preview.diff.every((d) => d.op === "same") && <span className="muted">没有改动。</span>}
            </pre>
          </section>
          <section aria-label="完整提示词">
            <div className="label">完整提示词</div>
            <pre className="max-h-80 overflow-auto rounded-lg border border-[var(--border)] p-2 text-[11px] whitespace-pre-wrap">
              {preview.system ??
                preview.panels?.map((p) => `— 分镜 ${p.panelId.slice(0, 8)} —\n${p.prompt}`).join("\n\n")}
            </pre>
          </section>
        </div>
      )}
      <div>
        <div className="label">版本</div>
        <ul className="space-y-1 text-sm">
          <li className="flex items-center gap-2">
            <span className="mr-auto">内置 v{t.builtInVersion}</span>
            {t.active ? (
              <button type="button" className="btn-ghost text-xs" onClick={() => activate.mutate(0)}>
                使用内置版本
              </button>
            ) : (
              <span className="chip text-xs">使用中</span>
            )}
          </li>
          {t.versions.map((v) => (
            <li key={v.id} className="flex items-center gap-2">
              <span className="mr-auto">
                v{v.version}{" "}
                <span className="muted text-xs">
                  · {fmt.ago(v.createdAt)}
                  {v.note ? ` · ${v.note}` : ""}
                </span>
              </span>
              {v.active ? (
                <span className="chip text-xs">使用中</span>
              ) : (
                <button type="button" className="btn-ghost text-xs" onClick={() => activate.mutate(v.version)}>
                  使用 v{v.version}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
