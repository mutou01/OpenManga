import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Bot, Check, CircleStop, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { get, post } from "../../api/client.ts";
import { EmptyState, ErrorBox, Field, fmt, PageHeader, Spinner, StatusChip, toast } from "../../components/ui.tsx";
import { AiChip, useAiBody } from "../ai/AiPicker.tsx";
import { useProjectId } from "../project/ProjectLayout.tsx";

type Step = {
  at: string;
  thought: string;
  tool: string | null;
  arguments?: Record<string, unknown>;
  status: "completed" | "pending_approval" | "error" | "denied" | "finished";
  result?: unknown;
};
type Run = {
  id: string;
  goal: string;
  status: string;
  model: string;
  budgetUsd: string | null;
  spentUsd: number;
  plan: {
    summary: string;
    steps: { title: string; tools: string[] }[];
    estimatedCostUsd: number | null;
    risks: string;
  } | null;
  steps: Step[];
  summary: string | null;
  error: string | null;
  createdAt: string;
  job: { id: string; status: string; failureReason: string | null } | null;
  approval: { id: string; status: string; summary: string; estimate: { estimatedUsd?: number } | null } | null;
};
type RunItem = Pick<Run, "id" | "goal" | "status" | "summary" | "createdAt">;

const ACTIVE = new Set(["planning", "awaiting_plan", "running", "waiting_approval"]);
const STATUS_LABEL: Record<string, string> = {
  planning: "规划中",
  awaiting_plan: "计划已就绪",
  running: "执行中",
  waiting_approval: "待审批",
  completed: "已完成",
  stopped: "已停止",
  failed: "失败",
  cancelled: "已取消",
};
const EXAMPLES = [
  "Audit this project and list what is missing or broken",
  "Fix the repeated narration but leave the art",
  "Finish what costs under $3",
];

/**
 * The project agent: a goal in words, a plan to approve, then the agent works through the same tools and approvals
 * as a connected MCP agent, one step at a time, with every call shown.
 */
export function AgentPage() {
  const projectId = useProjectId();
  const search = useSearch({ strict: false }) as { run?: string };
  const navigate = useNavigate();
  const runs = useQuery({
    queryKey: ["agent-runs", projectId],
    queryFn: () => get<{ runs: RunItem[] }>(`/projects/${projectId}/agent-runs`),
    refetchInterval: (q) => (q.state.data?.runs.some((r) => ACTIVE.has(r.status)) ? 4000 : false),
  });
  const open = (id: string) => void navigate({ to: ".", search: { run: id }, replace: true });
  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <PageHeader
        title="智能体"
        subtitle="为项目智能体设定目标。智能体会先制定计划，审批后再执行，产生费用或修改内容的操作会再次请求审批。"
      />
      <NewRun projectId={projectId} onStarted={open} />
      <div className="mt-6 grid gap-6 lg:grid-cols-[16rem_1fr]">
        <aside aria-label="执行记录" className="min-w-0">
          <h2 className="label mb-2">执行记录</h2>
          <ErrorBox error={runs.error} />
          {runs.isLoading && <Spinner />}
          {runs.data && !runs.data.runs.length && <p className="muted text-sm">暂无执行记录。</p>}
          <ul className="space-y-1">
            {runs.data?.runs.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={`w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--panel-2)] ${search.run === r.id ? "bg-[var(--panel-2)]" : ""}`}
                  onClick={() => open(r.id)}
                >
                  <span className="line-clamp-2">{r.goal}</span>
                  <span className="muted mt-0.5 flex items-center gap-1.5 text-xs">
                    <StatusChip status={r.status} label={STATUS_LABEL[r.status]} /> {fmt.ago(r.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="min-w-0">
          {search.run ? (
            <RunView key={search.run} id={search.run} projectId={projectId} />
          ) : (
            <EmptyState title="尚未打开执行记录">在上方创建任务，或打开已有执行记录。</EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}

function NewRun({ projectId, onStarted }: { projectId: string; onStarted: (id: string) => void }) {
  const qc = useQueryClient();
  const aiText = useAiBody("text");
  const [goal, setGoal] = useState("");
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const start = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { run } = await post<{ run: Run }>(`/projects/${projectId}/agent-runs`, {
        goal: goal.trim(),
        budgetUsd: budget === "" ? null : Number(budget),
        ...aiText(),
      });
      setGoal("");
      await qc.invalidateQueries({ queryKey: ["agent-runs", projectId] });
      onStarted(run.id);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card space-y-3 p-4" onSubmit={(e) => void start(e)}>
      <Field label="目标">
        <textarea
          className="input min-h-20"
          maxLength={4000}
          placeholder="你希望智能体在此项目中完成什么？"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((x) => (
          <button key={x} type="button" className="chip hover:bg-[var(--panel-2)]" onClick={() => setGoal(x)}>
            {x}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="预算（美元，可选）">
          <input
            className="input w-32"
            type="number"
            min={0}
            step={0.5}
            placeholder="不设上限"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </Field>
        <div className="pb-1">
          <span className="label">思考模型</span>
          <AiChip cap="text" />
        </div>
        <button type="submit" className="btn-primary ml-auto" disabled={busy || goal.trim().length < 3}>
          {busy ? <Spinner /> : <Bot className="size-4" />} 制定计划
        </button>
      </div>
    </form>
  );
}

function RunView({ id, projectId }: { id: string; projectId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["agent-run", id],
    queryFn: () => get<{ run: Run }>(`/agent-runs/${id}`),
    // Reading a run moves it on, so watching one is what keeps it quick.
    refetchInterval: (s) => (s.state.data && ACTIVE.has(s.state.data.run.status) ? 2000 : false),
  });
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  // The list beside it shows each run's status: keep it in step with the one being watched.
  const status = q.data?.run.status;
  useEffect(() => {
    if (status) void qc.invalidateQueries({ queryKey: ["agent-runs", projectId] });
  }, [status, projectId, qc]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["agent-run", id] });
      await qc.invalidateQueries({ queryKey: ["agent-runs", projectId] });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const r = q.data.run;
  const active = ACTIVE.has(r.status);
  return (
    <div className="space-y-4">
      <div className="card space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={r.status} label={STATUS_LABEL[r.status]} />
          <span className="muted text-xs">
            {r.model} · 已花费 ${r.spentUsd.toFixed(2)}
            {r.budgetUsd !== null && ` / 上限 $${Number(r.budgetUsd).toFixed(2)}`} · {fmt.ago(r.createdAt)}
          </span>
          {active && (
            <button
              type="button"
              className="btn-ghost ml-auto text-xs"
              disabled={busy}
              onClick={() => void act(() => post(`/agent-runs/${id}/cancel`, {}))}
            >
              <CircleStop className="size-3.5" /> 停止
            </button>
          )}
        </div>
        <p className="whitespace-pre-wrap text-sm">{r.goal}</p>
        {r.job?.status === "awaiting_input" && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            等待你粘贴回复{" "}
            <Link className="link" to="/projects/$projectId/generation/$jobId" params={{ projectId, jobId: r.job.id }}>
              回复此步骤
            </Link>
            .
          </p>
        )}
        {(r.status === "planning" || r.status === "running") && r.job?.status !== "awaiting_input" && (
          <p className="muted flex items-center gap-2 text-sm">
            <Spinner /> {r.status === "planning" ? "正在制定计划…" : "正在思考下一步…"}
          </p>
        )}
        {r.summary && <p className="whitespace-pre-wrap rounded-lg bg-[var(--panel-2)] p-3 text-sm">{r.summary}</p>}
        {r.error && <p className="text-sm text-red-600 dark:text-red-300">{r.error}</p>}
      </div>

      {r.plan && (
        <section aria-label="计划" className="card space-y-2 p-4">
          <h2 className="font-medium">计划</h2>
          <p className="text-sm">{r.plan.summary}</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {r.plan.steps.map((s, i) => (
              <li key={i}>
                {s.title}
                {s.tools.length > 0 && <span className="muted text-xs"> · {s.tools.join(", ")}</span>}
              </li>
            ))}
          </ol>
          <p className="muted text-xs">
            预计费用 {r.plan.estimatedCostUsd === null ? "未知" : `$${r.plan.estimatedCostUsd.toFixed(2)}`}
            {r.plan.risks && ` · ${r.plan.risks}`}
          </p>
          {r.status === "awaiting_plan" && (
            <div className="space-y-2 border-t border-[var(--border)] pt-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => void act(() => post(`/agent-runs/${id}/plan`, { decision: "approve" }))}
                >
                  <Check className="size-4" /> 批准并开始
                </button>
              </div>
              <Field label="或退回修改">
                <textarea
                  className="input min-h-14 text-sm"
                  placeholder="计划需要如何调整？"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                />
              </Field>
              <button
                type="button"
                className="btn-secondary text-sm"
                disabled={busy || !feedback.trim()}
                onClick={() =>
                  void act(async () => {
                    await post(`/agent-runs/${id}/plan`, { decision: "revise", feedback: feedback.trim() });
                    setFeedback("");
                  })
                }
              >
                修改计划
              </button>
            </div>
          )}
        </section>
      )}

      {r.status === "waiting_approval" && r.approval && (
        <section aria-label="需要审批" className="card space-y-2 border-amber-500/50 bg-amber-500/5 p-4 text-sm">
          <h2 className="font-medium">需要审批</h2>
          <p>{r.approval.summary}</p>
          {typeof r.approval.estimate?.estimatedUsd === "number" && (
            <p className="muted text-xs">预计费用 ${r.approval.estimate.estimatedUsd.toFixed(2)}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() =>
                void act(() => post(`/agents/approvals/${r.approval!.id}/decide`, { decision: "approve" }))
              }
            >
              <Check className="size-4" /> 批准
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => void act(() => post(`/agents/approvals/${r.approval!.id}/decide`, { decision: "deny" }))}
            >
              <X className="size-4" /> 拒绝
            </button>
            <Link className="btn-ghost text-xs" to="/agents" search={{ tab: "pending", request: r.approval.id }}>
              前往智能体访问页面
            </Link>
          </div>
        </section>
      )}

      {r.steps.length > 0 && (
        <section aria-label="步骤">
          <h2 className="label mb-2">步骤</h2>
          <ol className="space-y-2">
            {r.steps.map((s, i) => (
              <li key={i} className="card space-y-1 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="muted tabular-nums">{i + 1}.</span>
                  {s.tool ? <code className="chip">{s.tool}</code> : <span className="chip">已完成</span>}
                  <StatusChip
                    status={
                      s.status === "completed" || s.status === "finished"
                        ? "completed"
                        : s.status === "denied"
                          ? "cancelled"
                          : s.status === "error"
                            ? "failed"
                            : "pending"
                    }
                    label={
                      {
                        completed: "已完成",
                        pending_approval: "待审批",
                        error: "错误",
                        denied: "已拒绝",
                        finished: "已结束",
                      }[s.status]
                    }
                  />
                </div>
                {s.thought && <p className="muted">{s.thought}</p>}
                {s.tool && (
                  <details>
                    <summary className="cursor-pointer text-xs">参数与结果</summary>
                    <pre className="mt-1 max-h-72 overflow-auto rounded bg-[var(--panel-2)] p-2 text-xs">
                      {JSON.stringify({ arguments: s.arguments, result: s.result }, null, 2)}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
