import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, CircleDot, Loader2, PauseCircle, Rocket, XCircle } from "lucide-react";
import { useState } from "react";
import { get, post } from "../../api/client.ts";
import { ConfirmDialog, fmt, toast } from "../../components/ui.tsx";
import { statusLabel } from "../../lib/locale.ts";
import { AiChip, useAiBody } from "../ai/AiPicker.tsx";
import { AnalysisDiff } from "../story/AnalysisDiff.tsx";
import { CostPlan } from "./CostPlan.tsx";
import { PublishingFlags, StaleChapters, useStaleness } from "./StaleChapters.tsx";
import { WhyStale } from "./WhyStale.tsx";

type Step = { key: string; label: string; status: string; note?: string; ref?: string };
type Run = {
  id: string;
  status: string;
  reason: string | null;
  steps: Step[];
  createdAt: string;
  /** Changes with every step the run takes, which is what the staleness view must follow. */
  updatedAt: string;
  /** Jobs it queued that have not started: what Stop cancels by default. */
  pendingJobs: number;
  /** The project's unresolved comment threads: review notes still asking for changes. */
  openComments: number;
  warnings: Warnings | null;
};
type Warnings = {
  failedJobs: { id: string; kind: string; step: string; reason: string | null }[];
  failedJobCount: number;
  panelsWithoutArt: number;
  segmentsWithoutAudio: number;
  panelsNeedingReview: number;
  failedExports: { id: string; kind: string; reason: string | null }[];
  chaptersWithoutNarration?: number;
  failedChecks?: number;
  video?: string | null;
};

const STAGE_LABEL: Record<string, string> = {
  story: "故事",
  plan: "规划",
  prompts: "提示词",
  art: "画面",
  narration: "旁白",
  audio: "音频",
  render: "视频",
};

const ICON: Record<string, typeof Circle> = {
  pending: Circle,
  running: Loader2,
  review: PauseCircle,
  done: CheckCircle2,
  skipped: CheckCircle2,
  failed: XCircle,
};

/**
 * One-click production: every step from the story to the rendered video, reusing what exists, pausing for review
 * where asked and at the project's budget cap.
 */
export function ProductionRunCard({ projectId, format }: { projectId: string; format: string }) {
  const qc = useQueryClient();
  const key = ["project", projectId, "production-runs"];
  const runs = useQuery({
    queryKey: key,
    queryFn: () => get<{ runs: Run[] }>(`/projects/${projectId}/production-runs`),
    refetchInterval: (q) => (q.state.data?.runs[0]?.status === "running" ? 10_000 : false),
  });
  // Keyed on the run's last change, not its status: going from one review to the next keeps the status at
  // "waiting", and the list of changed chapters would otherwise stay hidden until a reload.
  const staleness = useStaleness(projectId, runs.data?.runs[0]?.updatedAt);
  // A revised story counts too: the update re-analyses it and always stops for a review before applying.
  const updatable = staleness.data?.stages.some((s) => s.count > 0) ?? false;
  const [update, setUpdate] = useState(false);
  const aiText = useAiBody("text");
  const aiImage = useAiBody("image");
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const [o, setO] = useState({ reviewGates: true, preparePrompts: true, render: true, youtube: format === "film" });
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [cancelJobs, setCancelJobs] = useState(true);
  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      await post(path, body);
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const run = runs.data?.runs[0];
  const reviewing =
    run?.status === "waiting" && run.steps.some((s) => s.key === "review_analysis" && s.status === "review");
  const analysisRef = run?.steps.find((s) => s.key === "analyze")?.ref;
  const deciding = run?.status === "waiting" ? run.steps.find((s) => s.status === "review")?.key : undefined;
  const active = run && ["running", "waiting", "paused", "failed"].includes(run.status);

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto flex items-center gap-2 text-sm font-medium">
          <Rocket className="size-4" /> 制作任务
        </h3>
        {!active && (
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={!updatable}
              title={updatable ? "只运行下方需要更新的步骤" : "所有步骤均为最新"}
              onClick={() => {
                setUpdate(true);
                setOpen(true);
              }}
            >
              更新制作
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setUpdate(false);
                setOpen(true);
              }}
            >
              一键制作
            </button>
          </>
        )}
      </div>
      {staleness.data && (
        // What is out of date, in the order each stage is made from the one before it.
        <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="待更新步骤">
          {staleness.data.stages.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1">
              {i > 0 && <span className="muted">→</span>}
              {s.count > 0 ? (
                // Out of date: opens why, item by item, below.
                <button
                  type="button"
                  className={`chip bg-amber-500/15 text-amber-700 dark:text-amber-300 ${why === s.key ? "ring-1 ring-amber-500" : ""}`}
                  title={`${s.note}（点击查看原因）`}
                  aria-expanded={why === s.key}
                  onClick={() => setWhy(why === s.key ? null : s.key)}
                >
                  {STAGE_LABEL[s.key] ?? s.key}
                  {s.key !== "render" && s.key !== "story" ? ` ${s.count}` : " !"}
                </button>
              ) : (
                <span className="chip bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" title="已是最新">
                  {STAGE_LABEL[s.key] ?? s.key} ✓
                </span>
              )}
            </li>
          ))}
          {staleness.data.publishing
            .filter((f) => f.stale)
            .map((f) => (
              <li key={f.key}>
                <span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300" title={f.reasons.join("; ")}>
                  {f.key === "youtube_text" ? "YouTube 文案 !" : "缩略图 !"}
                </span>
              </li>
            ))}
        </ol>
      )}
      {why && staleness.data?.stages.some((s) => s.key === why && s.count > 0) && (
        <WhyStale projectId={projectId} stage={why} label={STAGE_LABEL[why] ?? why} />
      )}
      {!run && (
        <p className="muted text-xs">
          一键完成故事分析、参考图、章节规划、提示词、画面、旁白、音频、缩略图和视频，自动跳过已完成的步骤。
        </p>
      )}
      {run && (
        <>
          <p className="text-xs">
            <span className="inline-block font-medium first-letter:uppercase">{statusLabel(run.status)}</span>
            <span className="muted"> · 开始于 {fmt.ago(run.createdAt)}</span>
            {run.reason && <span className="muted"> · {run.reason}</span>}
            {run.openComments > 0 && (
              <>
                {" · "}
                <Link
                  to="/projects/$projectId/comments"
                  params={{ projectId }}
                  className="text-amber-700 underline dark:text-amber-300"
                >
                  {run.openComments} 条未解决的评论
                </Link>
              </>
            )}
          </p>
          <ol className="space-y-1 text-xs">
            {run.steps.map((s) => {
              const Icon = ICON[s.status] ?? CircleDot;
              return (
                <li key={s.key} className="flex items-start gap-2">
                  <Icon
                    className={
                      s.status === "done" || s.status === "skipped"
                        ? "mt-0.5 size-3.5 shrink-0 text-emerald-600"
                        : s.status === "failed"
                          ? "mt-0.5 size-3.5 shrink-0 text-red-500"
                          : s.status === "running"
                            ? "mt-0.5 size-3.5 shrink-0 animate-spin"
                            : s.status === "review"
                              ? "mt-0.5 size-3.5 shrink-0 text-amber-600"
                              : "muted mt-0.5 size-3.5 shrink-0"
                    }
                  />
                  <span className={s.status === "skipped" ? "muted" : ""}>
                    {s.label}
                    {s.status === "skipped" && "（已跳过）"}
                    {s.note && <span className="muted"> — {s.note}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
          {reviewing && analysisRef && (
            // A re-analysis waits here: what applying it would change, and where to choose anything to remove.
            <div className="space-y-2">
              <AnalysisDiff analysisId={analysisRef} />
              <Link
                to="/projects/$projectId/story"
                params={{ projectId }}
                className="text-xs text-accent-500 hover:underline"
              >
                在故事页审核，也可以选择要移除的内容 →
              </Link>
            </div>
          )}
          {deciding === "review_plans" && staleness.data && (
            <StaleChapters projectId={projectId} stage="plan" chapters={staleness.data.stalePlans} />
          )}
          {deciding === "review_narration" && staleness.data && (
            <StaleChapters projectId={projectId} stage="narration" chapters={staleness.data.staleNarration} />
          )}
          {!active && staleness.data && <PublishingFlags projectId={projectId} flags={staleness.data.publishing} />}
          {run.status === "completed_with_warnings" && run.warnings && (
            <RunWarnings
              projectId={projectId}
              format={format}
              warnings={run.warnings}
              onChanged={() => qc.invalidateQueries({ queryKey: key })}
            />
          )}
          {active && (
            <div className="flex flex-wrap gap-2">
              {run.status !== "running" && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => act(`/production-runs/${run.id}/continue`)}
                >
                  {run.status === "waiting" ? "继续" : run.status === "failed" ? "重试失败步骤" : "恢复"}
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => {
                  setCancelJobs(true);
                  setStopping(true);
                }}
              >
                停止
              </button>
            </div>
          )}
        </>
      )}
      {run && (
        <ConfirmDialog
          open={stopping}
          title="停止制作任务"
          confirmLabel="停止"
          danger
          busy={busy}
          onClose={() => setStopping(false)}
          onConfirm={async () => {
            await act(`/production-runs/${run.id}/cancel`, { jobs: cancelJobs });
            setStopping(false);
          }}
        >
          <fieldset className="space-y-2">
            <legend className="sr-only">停止范围</legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="stop-run"
                className="mt-0.5"
                checked={cancelJobs}
                onChange={() => setCancelJobs(true)}
              />
              <span>
                停止制作并取消排队任务（推荐）
                <span className="muted block text-xs">
                  将取消 {run.pendingJobs} 个尚未开始的任务。服务商已开始处理的任务会继续完成，之后不会启动后续步骤。
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="stop-run"
                className="mt-0.5"
                checked={!cancelJobs}
                onChange={() => setCancelJobs(false)}
              />
              <span>
                仅停止制作流程
                <span className="muted block text-xs">排队任务仍会运行并产生费用，可在「生成任务」中取消。</span>
              </span>
            </label>
          </fieldset>
        </ConfirmDialog>
      )}
      <ConfirmDialog
        open={open}
        title={update ? "更新制作" : "一键制作此项目"}
        confirmLabel="开始"
        busy={busy}
        onClose={() => setOpen(false)}
        onConfirm={async () => {
          await act(`/projects/${projectId}/production-runs`, {
            ...o,
            update,
            ai: { text: aiText().ai ?? null, image: aiImage().ai ?? null },
          });
          setOpen(false);
        }}
      >
        <div className="space-y-3 text-sm">
          <p>
            {update
              ? "从最早需要更新的阶段开始。更新后的故事会重新分析并等待审核，再补齐规划、提示词和画面，重绘修改过的画格，更新旁白、音频和视频。视频会复用上一版中未变化的片段。"
              : "运行所有尚未完成的步骤。"}{" "}
            两种方式都会在项目<strong>预算上限</strong>内自动运行，达到上限后暂停。可在「项目设置 →
            制作」中选择哪些步骤使用服务商的半价批处理。
          </p>
          <div className="flex flex-wrap gap-2">
            <AiChip cap="text" />
            <AiChip cap="image" />
          </div>
          {(
            [
              ["reviewGates", "在故事分析后、参考图生成后和最终渲染前暂停，等待审核"],
              ["preparePrompts", "绘制前使用文本模型准备画格提示词"],
              ["render", "制作完成后渲染视频"],
              ["youtube", "生成并导出 YouTube 发布包"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={o[k]}
                onChange={(e) => setO({ ...o, [k]: e.target.checked })}
              />
              {label}
            </label>
          ))}
          {open && (
            <CostPlan
              projectId={projectId}
              body={{ ...o, update, ai: { text: aiText().ai ?? null, image: aiImage().ai ?? null } }}
            />
          )}
        </div>
      </ConfirmDialog>
    </div>
  );
}

/**
 * What a finished run left unresolved, each with where to deal with it: failed jobs are retried as new jobs through
 * the usual retry route, panels and narration open where they are fixed, and a failed video can be rendered anyway.
 */
function RunWarnings({
  projectId,
  format,
  warnings: w,
  onChanged,
}: {
  projectId: string;
  format: string;
  warnings: Warnings;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const failedVideo = w.failedExports.some((e) => e.kind === "video_pages" || e.kind === "video_panels");
  const total =
    w.failedJobCount +
    w.panelsWithoutArt +
    w.segmentsWithoutAudio +
    w.panelsNeedingReview +
    w.failedExports.length +
    (w.chaptersWithoutNarration ?? 0) +
    (w.failedChecks ?? 0) +
    (w.video ? 1 : 0);
  const retry = async () => {
    setBusy(true);
    let ok = 0;
    let firstError: unknown = null;
    for (const j of w.failedJobs) {
      try {
        await post(`/generations/${j.id}/retry`);
        ok++;
      } catch (e) {
        firstError ??= e;
      }
    }
    setBusy(false);
    if (ok) toast.success(`已重新排队 ${ok} 个任务`);
    if (firstError) toast.error(firstError);
    onChanged();
  };
  const render = async () => {
    setBusy(true);
    try {
      await post(`/projects/${projectId}/exports`, {
        kind: format === "film" ? "video_panels" : "video_pages",
        acknowledgeIssues: true,
      });
      toast.success("渲染已加入队列");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const items: { n: number; text: string; to: string; search?: Record<string, string> }[] = [
    { n: w.failedJobCount, text: "个生成任务失败", to: "/projects/$projectId/generation" },
    {
      n: w.panelsWithoutArt,
      text: "个画格缺少画面",
      to: "/projects/$projectId/storyboard",
      search: { filter: "noArt" },
    },
    {
      n: w.panelsNeedingReview,
      text: "个画格待审核",
      to: "/projects/$projectId/storyboard",
      search: { filter: "review" },
    },
    {
      n: w.segmentsWithoutAudio,
      text: "段旁白缺少最新音频",
      to: "/projects/$projectId/narration",
    },
    { n: w.failedExports.length, text: "个导出任务失败", to: "/projects/$projectId/exports" },
    { n: w.chaptersWithoutNarration ?? 0, text: "个章节缺少旁白", to: "/projects/$projectId/narration" },
    {
      n: w.failedChecks ?? 0,
      text: "个画格未通过画面检查",
      to: "/projects/$projectId/storyboard",
      search: { filter: "mismatch" },
    },
  ];
  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
      <p className="font-medium text-amber-800 dark:text-amber-200">制作已结束，仍有 {total} 项待处理</p>
      <ul className="space-y-1">
        {items
          .filter((i) => i.n > 0)
          .map((i) => (
            <li key={i.text}>
              <Link to={i.to} params={{ projectId }} search={i.search} className="text-accent-500 hover:underline">
                {i.n} {i.text} →
              </Link>
            </li>
          ))}
        {w.video && (
          <li>
            <Link to="/projects/$projectId/exports" params={{ projectId }} className="text-accent-500 hover:underline">
              {w.video} →
            </Link>
          </li>
        )}
        {w.failedExports.map((e) => (
          <li key={e.id} className="muted">
            {e.kind}: {e.reason ?? "失败"}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {w.failedJobs.length > 0 && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={retry}>
            重试失败任务（{w.failedJobs.length}）
          </button>
        )}
        {(w.panelsWithoutArt > 0 || w.panelsNeedingReview > 0) && (
          <Link
            to="/projects/$projectId/storyboard"
            params={{ projectId }}
            search={{ filter: w.panelsNeedingReview > 0 ? "review" : "noArt" }}
            className="btn-secondary"
          >
            审核
          </Link>
        )}
        {failedVideo && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={render}>
            仍然渲染
          </button>
        )}
      </div>
    </div>
  );
}
