import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Megaphone, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { get, patch, post } from "../../api/client.ts";
import { onProjectEvent, qk } from "../../api/hooks.ts";
import type { StoryAnalysisRow, StoryRevisionRow, StoryState } from "../../api/types.ts";
import {
  clsx,
  EmptyState,
  ErrorBox,
  Field,
  fmt,
  Modal,
  PageHeader,
  SaveIndicator,
  Spinner,
  StatusChip,
  toast,
  useAutosave,
} from "../../components/ui.tsx";
import { AiChip, useAiBody } from "../ai/AiPicker.tsx";
import { useProject, useProjectId } from "../project/ProjectLayout.tsx";
import { StaleChapters, useStaleness } from "../project/StaleChapters.tsx";
import { AnalysisReview } from "./AnalysisReview.tsx";
import { StoryCoverage } from "./StoryCoverage.tsx";

const revisionSources: Record<StoryRevisionRow["source"], string> = {
  initial: "初始版本",
  user_edit: "手动编辑",
  ai_rewrite: "AI 改写",
  import: "导入",
};

const inputKinds: Record<StoryRevisionRow["inputKind"], string> = {
  story: "故事",
  chapter: "章节",
  outline: "大纲",
  screenplay: "剧本",
  idea: "创意",
};

export function StoryPage() {
  const aiText = useAiBody("text");
  const projectId = useProjectId();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.story(projectId), queryFn: () => get<StoryState>(`/projects/${projectId}/story`) });
  const [viewRevisionId, setViewRevisionId] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [adOpen, setAdOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(
    () =>
      onProjectEvent((e) => {
        if (e.type === "job.updated" && e.kind === "story_rewrite" && e.status === "completed")
          toast.success("AI 改写已保存为新修订版");
        if (e.type === "job.updated" && e.kind === "ad_script") {
          if (e.status === "completed") {
            toast.success("广告脚本已保存为新修订版");
            void qc.invalidateQueries({ queryKey: qk.story(projectId) });
          } else if (e.status === "failed") toast.error("广告脚本生成失败");
        }
        if (e.type === "analysis.updated" && e.status === "completed") setAnalysisId(String(e.analysisId));
      }),
    [],
  );

  if (q.isLoading)
    return (
      <div className="p-6">
        <Spinner className="size-6" />
      </div>
    );
  if (q.error)
    return (
      <div className="p-6">
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      </div>
    );
  const data = q.data!;
  const latest = data.latest;
  const viewing = viewRevisionId && viewRevisionId !== latest?.id ? viewRevisionId : null;
  const selectedAnalysis =
    data.analyses.find((a) => a.id === analysisId) ??
    data.analyses.find((a) => a.status === "completed" || a.status === "applied") ??
    null;

  const analyze = async () => {
    if (!latest) return;
    setAnalyzing(true);
    try {
      const r = await post<{ analysis: StoryAnalysisRow }>(`/story-revisions/${latest.id}/analyze`, aiText());
      setAnalysisId(r.analysis.id);
      await qc.invalidateQueries({ queryKey: qk.story(projectId) });
      toast.info("分析已加入队列");
    } catch (e) {
      toast.error(e);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <PageHeader
        title="故事"
        subtitle="每次分析关联特定修订版，已分析的修订版会锁定，继续编辑将创建新修订版。"
        actions={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setAdOpen(true)}
              title="根据需求简报编写广告脚本"
            >
              <Megaphone className="size-4" /> 从简报创作广告
            </button>
            {latest && (
              <>
                <button type="button" className="btn-secondary" onClick={() => setRewriteOpen(true)}>
                  <Wand2 className="size-4" /> AI 改写
                </button>
                <AiChip cap="text" />
                <button type="button" className="btn-primary" onClick={analyze} disabled={analyzing}>
                  {analyzing ? <Spinner /> : <Sparkles className="size-4" />} 分析第 {latest.revisionNumber} 版
                </button>
              </>
            )}
          </>
        }
      />
      {!latest ? (
        <NewStory projectId={projectId} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="min-w-0">
            {viewing ? (
              <RevisionViewer id={viewing} projectId={projectId} onClose={() => setViewRevisionId(null)} />
            ) : (
              <StoryEditor key={projectId} revision={latest} projectId={projectId} />
            )}
          </div>
          <aside className="space-y-4">
            <div className="card p-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                <History className="size-4" /> 修订历史
              </h3>
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {data.revisions.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setViewRevisionId(r.id === latest.id ? null : r.id)}
                      className={clsx(
                        "w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--panel-2)]",
                        (viewing ? viewing === r.id : r.id === latest.id) && "bg-[var(--panel-2)]",
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-medium">修订版 {r.revisionNumber}</span>
                        <span className="muted text-[11px]">{revisionSources[r.source]}</span>
                      </div>
                      <div className="muted text-[11px]">
                        {fmt.num(r.length)} 字 · {fmt.ago(r.updatedAt)} {r.lockedAt ? "· 🔒 已分析" : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card p-3">
              <h3 className="mb-2 text-sm font-medium">分析记录</h3>
              {!data.analyses.length && <p className="muted text-xs">运行分析以提取角色、世界和章节。</p>}
              <ul className="space-y-1">
                {data.analyses.map((a) => {
                  const rev = data.revisions.find((r) => r.id === a.storyRevisionId);
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => setAnalysisId(a.id)}
                        className={clsx(
                          "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--panel-2)]",
                          selectedAnalysis?.id === a.id && "bg-[var(--panel-2)]",
                        )}
                      >
                        <span>
                          修订版 {rev?.revisionNumber ?? "?"} · {fmt.ago(a.createdAt)}
                        </span>
                        <StatusChip status={a.status} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>
        </div>
      )}
      {selectedAnalysis && (selectedAnalysis.status === "completed" || selectedAnalysis.status === "applied") && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">分析审核</h2>
          <AnalysisReview analysis={selectedAnalysis} projectId={projectId} />
        </section>
      )}
      {data.analyses.some((a) => a.status === "applied") && (
        <StoryCoverage
          projectId={projectId}
          onShowSpan={(revisionId, start, end) => {
            if (revisionId !== latest?.id) {
              setViewRevisionId(revisionId);
              toast.info(`报告基于较早的修订版，涉及第 ${start} 至 ${end} 字`);
              return;
            }
            setViewRevisionId(null);
            // The editor holds the latest revision; select the span in it and bring it into view.
            requestAnimationFrame(() => {
              const t = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="故事正文"]');
              if (!t) return;
              t.focus();
              t.setSelectionRange(start, end);
              const line = Number.parseFloat(getComputedStyle(t).lineHeight) || 20;
              t.scrollTop = Math.max(0, (t.value.slice(0, start).split("\n").length - 3) * line);
              t.scrollIntoView({ block: "center", behavior: "smooth" });
            });
          }}
        />
      )}
      <ChangedChapters projectId={projectId} />
      {data.analyses.some((a) => a.status === "pending") && (
        <div className="card mt-6 flex items-center gap-2 p-3 text-sm">
          <Spinner /> 分析正在进行，结果会自动显示在此处。
        </div>
      )}
      {latest && <RewriteModal open={rewriteOpen} onClose={() => setRewriteOpen(false)} revisionId={latest.id} />}
      <AdBriefModal open={adOpen} onClose={() => setAdOpen(false)} projectId={projectId} />
    </div>
  );
}

function StoryEditor({ revision, projectId }: { revision: StoryRevisionRow; projectId: string }) {
  const qc = useQueryClient();
  const [content, setContent] = useState(revision.content);
  const [title, setTitle] = useState(revision.title);
  const [base, setBase] = useState({
    id: revision.id,
    sha: revision.contentSha256,
    locked: Boolean(revision.lockedAt),
  });
  const newer = revision.id !== base.id && revision.contentSha256 !== base.sha;
  const { state, markSaved } = useAutosave({ content, title }, async (v) => {
    const r = await patch<{ revision: StoryRevisionRow; forked: boolean }>(`/story-revisions/${base.id}`, {
      content: v.content,
      title: v.title,
      baseSha256: base.locked ? undefined : base.sha,
    });
    setBase({ id: r.revision.id, sha: r.revision.contentSha256, locked: Boolean(r.revision.lockedAt) });
    if (r.forked) {
      toast.info(`已另存为修订版 ${r.revision.revisionNumber}，上一版已关联分析结果并锁定。`);
    }
    await qc.invalidateQueries({ queryKey: qk.story(projectId) });
  });
  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-sm font-medium"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="未命名"
          aria-label="故事标题"
        />
        <span className="muted text-xs">
          修订版 {revision.revisionNumber} · {inputKinds[revision.inputKind]}
          {base.locked ? " · 已锁定（编辑将创建新修订版）" : ""}
        </span>
        <span className="ml-auto">
          <SaveIndicator state={state} />
        </span>
      </div>
      {newer && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-accent-500/40 bg-accent-600/10 p-2 text-sm">
          <span>
            修订版 {revision.revisionNumber} ({revisionSources[revision.source]}) 晚于当前正在编辑的版本。
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              markSaved({ content: revision.content, title: revision.title });
              setContent(revision.content);
              setTitle(revision.title);
              setBase({ id: revision.id, sha: revision.contentSha256, locked: Boolean(revision.lockedAt) });
            }}
          >
            载入修订版 {revision.revisionNumber}
          </button>
        </div>
      )}
      <textarea
        className="input min-h-[60vh] font-mono text-sm leading-relaxed"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        aria-label="故事正文"
        spellCheck
      />
      <div className="muted mt-1 text-right text-xs">{content.length.toLocaleString()} 字</div>
    </div>
  );
}

function RevisionViewer({ id, projectId, onClose }: { id: string; projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["story-revision", id],
    queryFn: () => get<{ revision: StoryRevisionRow }>(`/story-revisions/${id}`),
  });
  const [busy, setBusy] = useState(false);
  if (!q.data) return <div className="card p-6">{q.error ? <ErrorBox error={q.error} /> : <Spinner />}</div>;
  const r = q.data.revision;
  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="font-medium">
          修订版 {r.revisionNumber}{" "}
          <span className="muted text-xs">
            ({revisionSources[r.source]}, {fmt.date(r.createdAt)}) · 只读
          </span>
        </div>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            返回最新版本
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await post(`/projects/${projectId}/story/revisions`, {
                  content: r.content,
                  title: r.title,
                  inputKind: r.inputKind,
                });
                await qc.invalidateQueries({ queryKey: qk.story(projectId) });
                toast.success("已恢复为新修订版");
                onClose();
              } catch (e) {
                toast.error(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            恢复为新修订版
          </button>
        </div>
      </div>
      <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--panel-2)] p-3 font-mono text-sm">
        {r.content}
      </pre>
    </div>
  );
}

function NewStory({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <EmptyState title="暂无故事" action={null}>
      <div className="mt-2 w-full max-w-2xl text-left">
        <textarea
          className="input min-h-60 font-mono text-sm"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="粘贴故事、章节、大纲、剧本或创意……"
          aria-label="故事正文"
        />
        <button
          type="button"
          className="btn-primary mt-2"
          disabled={!content.trim() || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await post(`/projects/${projectId}/story/revisions`, { content });
              await qc.invalidateQueries({ queryKey: qk.story(projectId) });
            } catch (e) {
              toast.error(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Spinner />} 保存故事
        </button>
      </div>
    </EmptyState>
  );
}

function RewriteModal({ open, onClose, revisionId }: { open: boolean; onClose: () => void; revisionId: string }) {
  const aiRewrite = useAiBody("text");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI 改写"
      footer={
        <>
          <AiChip cap="text" className="mr-auto" />
          <button type="button" className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || instruction.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              try {
                await post(`/story-revisions/${revisionId}/rewrite`, { ...aiRewrite(), instruction });
                toast.info("改写已加入队列，完成后会显示为新修订版。");
                setInstruction("");
                onClose();
              } catch (e) {
                toast.error(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner />} 开始改写
          </button>
        </>
      }
    >
      <p className="muted mb-2 text-sm">文本模型会根据当前版本改写，并保存为新修订版。</p>
      <textarea
        className="input min-h-28"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="例如，压缩节奏，增加两位主角的对白，并以悬念结尾。"
        aria-label="改写要求"
      />
    </Modal>
  );
}

/** After a revised story is applied: the chapters whose text changed since they were planned, to keep or re-plan. */
function ChangedChapters({ projectId }: { projectId: string }) {
  const q = useStaleness(projectId);
  if (!q.data?.stalePlans.length) return null;
  return (
    <section className="mt-8">
      <StaleChapters projectId={projectId} stage="plan" chapters={q.data.stalePlans} />
    </section>
  );
}

type Brief = {
  product: string;
  audience: string;
  message: string;
  offer: string;
  callToAction: string;
  notes: string;
  lengthSeconds: number;
  tone: string;
};
const EMPTY_BRIEF: Brief = {
  product: "",
  audience: "",
  message: "",
  offer: "",
  callToAction: "",
  notes: "",
  lengthSeconds: 60,
  tone: "",
};

/**
 * An ad from a brief: what is sold, to whom, the one thing to remember, the offer and the call to action, at a length.
 * The text model writes the script (scenes with what is seen, the voiceover and text on screen) as a new revision of
 * the story; analyse and plan it like any story, then animate the shots.
 */
function AdBriefModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const aiText = useAiBody("text");
  const saved = useProject().data?.project.settings.ad as Partial<Brief> | undefined;
  const [brief, setBrief] = useState<Brief>({ ...EMPTY_BRIEF, ...saved });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setBrief({ ...EMPTY_BRIEF, ...saved });
  }, [open, saved]);
  const set = (k: keyof Brief) => (e: { target: { value: string } }) =>
    setBrief((b) => ({ ...b, [k]: k === "lengthSeconds" ? Number(e.target.value) || 60 : e.target.value }));
  const field = (k: keyof Brief, label: string, placeholder: string, area = false) => (
    <Field label={label}>
      {area ? (
        <textarea
          className="input min-h-16"
          aria-label={label}
          value={String(brief[k])}
          onChange={set(k)}
          placeholder={placeholder}
        />
      ) : (
        <input
          className="input"
          aria-label={label}
          value={String(brief[k])}
          onChange={set(k)}
          placeholder={placeholder}
        />
      )}
    </Field>
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="从简报创作广告"
      footer={
        <>
          <AiChip cap="text" className="mr-auto" />
          <button type="button" className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || brief.product.trim().length < 2}
            onClick={async () => {
              setBusy(true);
              try {
                await post(`/projects/${projectId}/ad-script`, { ...aiText(), brief });
                toast.info("正在编写广告脚本，完成后会显示为新修订版。");
                onClose();
              } catch (e) {
                toast.error(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner />} 编写脚本
          </button>
        </>
      }
    >
      <div className="space-y-2">
        <p className="muted text-sm">
          脚本按场景组织，每个场景包含画面、旁白及屏幕文字，并匹配指定时长。脚本会保存为故事的新修订版，之后可分析、规划、绘制镜头并制作动画。
        </p>
        {field("product", "产品或服务", "例如，Glowtide 模拟日出唤醒的台灯", true)}
        {field("audience", "目标受众", "例如，经常熬夜且起床疲倦的人")}
        {field("message", "核心记忆点", "例如，用晨光温柔唤醒")}
        <div className="grid grid-cols-2 gap-2">
          {field("offer", "优惠", "例如，本周七折")}
          {field("callToAction", "行动号召", "例如，前往 glowtide.com 下单")}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="时长（秒）">
            <input
              className="input"
              type="number"
              min={10}
              max={600}
              aria-label="时长（秒）"
              value={brief.lengthSeconds}
              onChange={set("lengthSeconds")}
            />
          </Field>
          {field("tone", "语气", "例如，温暖、平静、有质感")}
        </div>
        {field("notes", "备注", "品牌规范、避免的说法、建议使用的词语", true)}
      </div>
    </Modal>
  );
}
