import {
  type ProjectConcept,
  ProjectConcept as ProjectConceptSchema,
  ProjectPremise,
  StoryOutline,
  YoutubePackage,
} from "@openmanga/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, ExternalLink, Plus, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";
import type { z } from "zod";
import { get, post } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import { ConfirmDialog, Field, Modal, Spinner, toast } from "../../components/ui.tsx";
import { projectTypeLabel } from "../../lib/locale.ts";
import { useAiBody } from "../ai/AiPicker.tsx";
import { ManualAnswer } from "../generation/JobDetailPage.tsx";
import { CopyButton } from "../generation/shared.tsx";

export type ExpertAction = "concept" | "premise" | "outline" | "youtube";
export type Extraction = {
  id: string;
  messageId: string;
  projectId: string | null;
  action: ExpertAction;
  status: string;
  manual: boolean;
  result: Record<string, unknown> | null;
  /** Set once it has been applied: when, how many times, and what it created or changed. */
  applied: { at: string; count: number; pending?: boolean; projectId?: string; revisionId?: string } | null;
  failureReason: string | null;
  createdAt: string;
};

const ACTIONS: { action: ExpertAction; label: string; needsProject: boolean; title: string }[] = [
  { action: "concept", label: "新建项目", needsProject: false, title: "根据此创意创建新项目" },
  { action: "premise", label: "故事设定", needsProject: true, title: "用作项目的故事设定（描述）" },
  { action: "outline", label: "故事大纲", needsProject: true, title: "保存为故事的大纲修订版" },
  { action: "youtube", label: "YouTube 文案", needsProject: true, title: "用作项目的 YouTube 发布文案" },
];
const LABEL: Record<ExpertAction, string> = {
  concept: "新建项目",
  premise: "故事设定",
  outline: "故事大纲",
  youtube: "YouTube 文案",
};
export const RUNNING = new Set(["queued", "processing", "submitted", "cancel_requested"]);

/**
 * Under an expert's reply: turn it into something applied. Each action first extracts a structured object (a text
 * job, with a key or pasted by hand), which is shown for review and editing; nothing changes until it is applied.
 */
export function ExpertActions({
  chatId,
  messageId,
  projectId,
  extractions,
}: {
  chatId: string;
  messageId: string;
  projectId: string | null;
  extractions: Extraction[];
}) {
  const aiText = useAiBody("text");
  const start = useAction(
    (action: ExpertAction) => post(`/expert-messages/${messageId}/extract`, { action, ...aiText() }),
    { invalidate: [["expert-chat", chatId]] },
  );
  // The newest run of each action: an older one was replaced by running it again.
  const latest = ACTIONS.map((a) => extractions.find((e) => e.action === a.action)).filter((e): e is Extraction =>
    Boolean(e),
  );
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        <span className="muted inline-flex items-center gap-1">
          <Wand2 className="size-3" /> 用于
        </span>
        {ACTIONS.map((a) => {
          const off = a.needsProject && !projectId;
          return (
            <button
              key={a.action}
              type="button"
              className="chip border border-[var(--border)] disabled:opacity-50"
              disabled={off || start.isPending}
              title={off ? "请先选择此对话关联的项目" : a.title}
              onClick={() => start.mutate(a.action)}
            >
              {a.label}
            </button>
          );
        })}
      </div>
      {latest.map((e) => (
        <ExtractionCard key={e.id} chatId={chatId} extraction={e} onRetry={() => start.mutate(e.action)} />
      ))}
    </div>
  );
}

function ExtractionCard({
  chatId,
  extraction: e,
  onRetry,
}: {
  chatId: string;
  extraction: Extraction;
  onRetry: () => void;
}) {
  const qc = useQueryClient();
  const [reviewing, setReviewing] = useState<false | "first" | "again">(false);
  const [confirmAgain, setConfirmAgain] = useState(false);
  const applied = e.applied && !e.applied.pending ? e.applied : null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["expert-chat", chatId] });
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{LABEL[e.action]}</span>
        {RUNNING.has(e.status) && (
          <span className="muted inline-flex items-center gap-1">
            <Spinner /> 正在读取回复…
          </span>
        )}
        {e.status === "completed" && !e.applied && (
          <button type="button" className="btn-primary px-2 py-0.5 text-xs" onClick={() => setReviewing("first")}>
            <Check className="size-3.5" /> 审阅并应用
          </button>
        )}
        {e.applied?.pending && (
          <span className="muted inline-flex items-center gap-1">
            <Spinner /> 正在应用…
          </span>
        )}
        {applied && (
          <>
            <span className="inline-flex items-center gap-1 text-emerald-600">
              <Check className="size-3.5" /> 已应用{applied.count > 1 ? ` ${applied.count} 次` : ""}
            </span>
            {applied.projectId && (
              <Link
                to={applied.revisionId ? "/projects/$projectId/story" : "/projects/$projectId"}
                params={{ projectId: applied.projectId }}
                className="inline-flex items-center gap-1 hover:underline"
              >
                {applied.revisionId ? "打开修订版" : "打开项目"} <ExternalLink className="size-3" />
              </Link>
            )}
            <button type="button" className="btn-ghost px-1 py-0 text-xs" onClick={() => setConfirmAgain(true)}>
              再次应用
            </button>
          </>
        )}
        {(e.status === "failed" || e.status === "cancelled") && (
          <>
            <span className="text-red-500">
              {e.failureReason ?? (e.status === "cancelled" ? "提取已取消。" : "提取失败。")}
            </span>
            <button type="button" className="btn-ghost px-1 py-0 text-xs" onClick={onRetry}>
              重试
            </button>
          </>
        )}
        {e.projectId && (
          <Link
            to="/projects/$projectId/generation/$jobId"
            params={{ projectId: e.projectId, jobId: e.id }}
            className="muted ml-auto inline-flex items-center gap-1 hover:underline"
          >
            任务 <ExternalLink className="size-3" />
          </Link>
        )}
      </div>
      {e.status === "awaiting_input" && <PasteStep jobId={e.id} onSubmitted={refresh} />}
      {reviewing && e.result && (
        <Review
          chatId={chatId}
          extraction={e}
          result={e.result}
          again={reviewing === "again"}
          onClose={() => setReviewing(false)}
        />
      )}
      <ConfirmDialog
        open={confirmAgain}
        title="再次应用此结果？"
        confirmLabel="审阅并再次应用"
        onConfirm={() => {
          setConfirmAgain(false);
          setReviewing("again");
        }}
        onClose={() => setConfirmAgain(false)}
      >
        此结果已应用
        {applied ? `于 ${new Date(applied.at).toLocaleString("zh-CN")}` : ""}。再次应用将{" "}
        {e.action === "concept"
          ? "创建另一个项目"
          : e.action === "outline"
            ? "保存另一个大纲修订版"
            : "再次用此内容替换当前文案"}
        .
      </ConfirmDialog>
    </div>
  );
}

/** Paste mode: copy the extraction prompt into any chat and paste its JSON back, checked like a provider's answer. */
function PasteStep({ jobId, onSubmitted }: { jobId: string; onSubmitted: () => void }) {
  const manual = useQuery({
    queryKey: [...qk.job(jobId), "manual-prompt"],
    queryFn: () =>
      get<{ prompt: string; lastError: string | null; attachments: string[]; answered: number }>(
        `/generations/${jobId}/manual`,
      ),
  });
  if (!manual.data) return <Spinner className="mt-2" />;
  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="muted">将提示词复制到任意对话中，再将回答粘贴到下方。</span>
        <CopyButton text={manual.data.prompt} label="复制提示词" />
      </div>
      <ManualAnswer
        jobId={jobId}
        lastError={manual.data.lastError}
        attachments={manual.data.attachments}
        answered={manual.data.answered}
        onSubmitted={onSubmitted}
      />
    </div>
  );
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** Checks an edited result against the schema the extraction used, and says what is wrong in words. */
function checked<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const i = r.error.issues[0];
  toast.error(`${i?.path.join(".") || "字段"}: ${i?.message ?? "无效"}`);
  return null;
}

/** Applies an extraction through the server, which records it so it is never applied twice by accident. */
type Apply = (data: unknown, opts?: { attachChat?: boolean }) => void;

function Review({
  chatId,
  extraction: e,
  result,
  again,
  onClose,
}: {
  chatId: string;
  extraction: Extraction;
  result: Record<string, unknown>;
  again: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const run = useAction(
    (v: { data: unknown; attachChat?: boolean }) =>
      post<{ applied: { projectId?: string; revisionId?: string } }>(`/expert-extractions/${e.id}/apply`, {
        ...v,
        again,
      }),
    {
      invalidate: [
        ["expert-chat", chatId],
        ["expert-chats"],
        ["projects"],
        ...(e.projectId ? [qk.project(e.projectId)] : []),
      ],
      onSuccess: (r) => {
        toast.success(
          {
            concept: "项目已创建",
            premise: "项目描述已替换",
            outline: "大纲已保存为新的故事修订版",
            youtube: "YouTube 发布文案已替换",
          }[e.action],
        );
        onClose();
        if (e.action === "concept" && r.applied.projectId)
          navigate({ to: "/projects/$projectId", params: { projectId: r.applied.projectId } });
      },
    },
  );
  const apply: Apply = (data, opts) => run.mutate({ data, ...opts });
  const busy = run.isPending;
  const title = {
    concept: "根据此创意新建项目",
    premise: "替换项目的故事设定",
    outline: "保存为大纲修订版",
    youtube: "替换 YouTube 发布文案",
  }[e.action];
  return (
    <Modal open onClose={onClose} title={title} wide>
      <p className="muted mb-3 text-xs">审阅从回复中提取的内容，可按需修改，应用后生效。</p>
      {e.action === "concept" && <ConceptForm value={result as ProjectConcept} apply={apply} busy={busy} />}
      {e.action === "premise" && e.projectId && (
        <PremiseForm
          projectId={e.projectId}
          value={result as { logline: string; premise: string }}
          apply={apply}
          busy={busy}
        />
      )}
      {e.action === "outline" && (
        <OutlineForm value={result as z.infer<typeof StoryOutline>} apply={apply} busy={busy} />
      )}
      {e.action === "youtube" && (
        <YoutubeForm value={result as z.infer<typeof YoutubePackage>} apply={apply} busy={busy} />
      )}
    </Modal>
  );
}

function ConceptForm({ value, apply, busy }: { value: ProjectConcept; apply: Apply; busy: boolean }) {
  const [v, setV] = useState(value);
  const [attach, setAttach] = useState(true);
  const set = (k: keyof ProjectConcept) => (x: { target: { value: string } }) => setV({ ...v, [k]: x.target.value });
  const submit = () => {
    const c = checked(ProjectConceptSchema, v);
    if (c) apply(c, { attachChat: attach });
  };
  return (
    <div className="space-y-3">
      <Field label="标题">
        <input className="input" value={v.title} onChange={set("title")} />
      </Field>
      <Field label="一句话梗概">
        <input className="input" value={v.logline} onChange={set("logline")} />
      </Field>
      <Field label="故事设定" hint="与一句话梗概一起作为项目描述。">
        <textarea className="input min-h-28 text-sm" value={v.premise} onChange={set("premise")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="类型">
          <select className="input" value={v.projectType} onChange={set("projectType")}>
            {["manhwa", "manga", "webtoon", "comic", "illustrated_story"].map((t) => (
              <option key={t} value={t}>
                {projectTypeLabel(t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="格式">
          <select className="input" value={v.format} onChange={set("format")}>
            <option value="comic">漫画分页</option>
            <option value="film">影片（16:9 镜头）</option>
            <option value="vertical">竖向条漫</option>
          </select>
        </Field>
      </div>
      <Field label="故事创意" hint="保存为项目的第一个故事修订版，以便分析或继续完善。">
        <textarea className="input min-h-40 text-sm" value={v.storyIdea} onChange={set("storyIdea")} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={attach} onChange={(x) => setAttach(x.target.checked)} />
        在此对话中继续讨论新项目
      </label>
      <div className="flex justify-end">
        <button type="button" className="btn-primary" disabled={busy} onClick={submit}>
          {busy ? <Spinner /> : <Plus className="size-4" />} 创建项目
        </button>
      </div>
    </div>
  );
}

function PremiseForm({
  projectId,
  value,
  apply,
  busy,
}: {
  projectId: string;
  value: { logline: string; premise: string };
  apply: Apply;
  busy: boolean;
}) {
  const [v, setV] = useState(value);
  const current = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => get<{ project: { description: string } }>(`/projects/${projectId}`),
  });
  const submit = () => {
    const p = checked(ProjectPremise, v);
    if (p) apply(p);
  };
  return (
    <div className="space-y-3">
      <Field label="一句话梗概">
        <input className="input" value={v.logline} onChange={(x) => setV({ ...v, logline: x.target.value })} />
      </Field>
      <Field label="故事设定">
        <textarea
          className="input min-h-32 text-sm"
          value={v.premise}
          onChange={(x) => setV({ ...v, premise: x.target.value })}
        />
      </Field>
      {current.data?.project.description && (
        <details className="text-xs">
          <summary className="muted cursor-pointer">将被替换的描述</summary>
          <p className="mt-1 whitespace-pre-wrap">{current.data.project.description}</p>
        </details>
      )}
      <div className="flex justify-end">
        <button type="button" className="btn-primary" disabled={busy} onClick={submit}>
          {busy ? <Spinner /> : <Check className="size-4" />} 替换描述
        </button>
      </div>
    </div>
  );
}

function OutlineForm({ value, apply, busy }: { value: z.infer<typeof StoryOutline>; apply: Apply; busy: boolean }) {
  const [v, setV] = useState(value);
  const setChapter = (i: number, k: "title" | "summary", x: string) =>
    setV({ ...v, chapters: v.chapters.map((c, n) => (n === i ? { ...c, [k]: x } : c)) });
  const submit = () => {
    const o = checked(StoryOutline, v);
    if (o) apply(o);
  };
  return (
    <div className="space-y-3">
      <Field label="修订版标题">
        <input className="input" value={v.title} onChange={(x) => setV({ ...v, title: x.target.value })} />
      </Field>
      <ol className="space-y-2">
        {v.chapters.map((c, i) => (
          <li key={i} className="rounded-lg border border-[var(--border)] p-2">
            <div className="flex items-center gap-2">
              <span className="muted text-xs">{i + 1}.</span>
              <input
                className="input flex-1"
                aria-label={`第 ${i + 1} 章标题`}
                value={c.title}
                onChange={(x) => setChapter(i, "title", x.target.value)}
              />
              <button
                type="button"
                className="btn-ghost p-1.5 text-red-500"
                aria-label={`移除第 ${i + 1} 章`}
                disabled={v.chapters.length === 1}
                onClick={() => setV({ ...v, chapters: v.chapters.filter((_, n) => n !== i) })}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <textarea
              className="input mt-1 min-h-16 text-sm"
              aria-label={`第 ${i + 1} 章摘要`}
              value={c.summary}
              onChange={(x) => setChapter(i, "summary", x.target.value)}
            />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap justify-between gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setV({ ...v, chapters: [...v.chapters, { title: "", summary: "" }] })}
        >
          <Plus className="size-4" /> 添加章节
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={submit}>
          {busy ? <Spinner /> : <Check className="size-4" />} 保存大纲
        </button>
      </div>
    </div>
  );
}

function YoutubeForm({ value, apply, busy }: { value: z.infer<typeof YoutubePackage>; apply: Apply; busy: boolean }) {
  const [titles, setTitles] = useState(value.titles.join("\n"));
  const [description, setDescription] = useState(value.description);
  const [tags, setTags] = useState(value.tags.join(", "));
  const [pinnedComment, setPinnedComment] = useState(value.pinnedComment);
  const [headlines, setHeadlines] = useState(value.thumbnailHeadlines.join("\n"));
  const submit = () => {
    const y = checked(YoutubePackage, {
      titles: lines(titles),
      description,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      pinnedComment,
      thumbnailHeadlines: lines(headlines),
    });
    if (y) apply(y);
  };
  return (
    <div className="space-y-3">
      <Field label="标题候选" hint="每行一条，最佳标题排在最前。">
        <textarea className="input min-h-20 text-sm" value={titles} onChange={(x) => setTitles(x.target.value)} />
      </Field>
      <Field label="描述">
        <textarea
          className="input min-h-32 text-sm"
          value={description}
          onChange={(x) => setDescription(x.target.value)}
        />
      </Field>
      <Field label="标签" hint="以英文逗号分隔。">
        <input className="input" value={tags} onChange={(x) => setTags(x.target.value)} />
      </Field>
      <Field label="置顶评论">
        <input className="input" value={pinnedComment} onChange={(x) => setPinnedComment(x.target.value)} />
      </Field>
      <Field label="缩略图标题" hint="每行一条。">
        <textarea className="input min-h-16 text-sm" value={headlines} onChange={(x) => setHeadlines(x.target.value)} />
      </Field>
      <div className="flex justify-end">
        <button type="button" className="btn-primary" disabled={busy} onClick={submit}>
          {busy ? <Spinner /> : <Check className="size-4" />} 替换 YouTube 文案
        </button>
      </div>
    </div>
  );
}
