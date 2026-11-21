import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Cpu, RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";
import { get, post } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import type { JobListItem } from "../../api/types.ts";
import { AssetImage, EmptyState, ErrorBox, fmt, PageHeader, Pager, Spinner, StatusChip } from "../../components/ui.tsx";
import { statusLabel } from "../../lib/locale.ts";
import { useProjectId } from "../project/ProjectLayout.tsx";
import { ActiveBatches } from "./BatchStatus.tsx";
import { JOB_STATUSES, KIND_LABELS, kindLabel, ProgressBar } from "./shared.tsx";

type ListResponse = { jobs: JobListItem[]; counts: Record<string, number>; total: number };
const PAGE = 50;

export function GenerationPage() {
  const projectId = useProjectId();
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(0);
  const filter = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(0);
  };
  const setStatusAt = filter(setStatus);
  const setKindAt = filter(setKind);

  const q = useQuery({
    queryKey: [...qk.generations(projectId), status, kind, page],
    queryFn: () => {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) });
      if (status) p.set("status", status);
      if (kind) p.set("kind", kind);
      return get<ListResponse>(`/projects/${projectId}/generations?${p}`);
    },
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const c = query.state.data?.counts;
      // Live events refresh the list; this only covers a dropped event stream.
      return c && (c.queued ?? 0) + (c.processing ?? 0) > 0 ? 15_000 : false;
    },
  });

  const cancel = useAction((id: string) => post<{ result: string }>(`/generations/${id}/cancel`), {
    invalidate: [qk.generations(projectId)],
    success: (r) => (r.result === "cancel_requested" ? "已请求取消，正在生成的结果不会启用" : "任务已取消"),
  });
  const retry = useAction((id: string) => post(`/generations/${id}/retry`), {
    invalidate: [qk.generations(projectId)],
    success: "重试已加入队列",
  });

  const counts = q.data?.counts ?? {};
  const jobs = q.data?.jobs ?? [];
  const pager = (className?: string) => (
    <Pager
      page={page}
      size={PAGE}
      total={q.data?.total ?? 0}
      onPage={setPage}
      busy={q.isPlaceholderData}
      className={className}
    />
  );
  const total =
    (counts.queued ?? 0) +
    (counts.awaiting_input ?? 0) +
    (counts.processing ?? 0) +
    (counts.completed ?? 0) +
    (counts.failed ?? 0) +
    (counts.cancelled ?? 0);
  const done = (counts.completed ?? 0) + (counts.failed ?? 0) + (counts.cancelled ?? 0);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader title="生成任务" subtitle="查看每次 AI 调用的请求内容与费用。" />
      <ActiveBatches projectId={projectId} className="mb-4" />
      <div className="card mb-4 p-4">
        <div className="mb-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          {(["queued", "processing", "completed", "failed", "cancelled"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="text-left"
              onClick={() => setStatusAt(status === s ? "" : s === "cancelled" ? "cancelled,cancel_requested" : s)}
            >
              <div className="muted text-xs capitalize">{statusLabel(s)}</div>
              <div className="text-xl font-semibold">{counts[s] ?? 0}</div>
            </button>
          ))}
        </div>
        <ProgressBar value={total ? done / total : 0} label="已结束的任务" />
        <div className="muted mt-1 text-xs">
          已完成 {counts.completed ?? 0} / {total} · 生成中 {counts.processing ?? 0} · 排队中 {counts.queued ?? 0}
          {(counts.awaiting_input ?? 0) > 0 && (
            <button type="button" className="ml-1 underline" onClick={() => setStatusAt("awaiting_input")}>
              · {counts.awaiting_input} 项等待你的回答
            </button>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <select
          className="input w-auto"
          value={status}
          onChange={(e) => setStatusAt(e.target.value)}
          aria-label="按状态筛选"
        >
          <option value="">全部状态</option>
          {JOB_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <select
          className="input w-auto"
          value={kind}
          onChange={(e) => setKindAt(e.target.value)}
          aria-label="按类型筛选"
        >
          <option value="">全部类型</option>
          {Object.entries(KIND_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        {pager("ml-auto")}
      </div>

      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? (
        <Spinner />
      ) : !jobs.length ? (
        <EmptyState icon={<Cpu className="size-8" />} title="暂无生成任务">
          故事分析、参考图、画格生成、图片编辑与旁白文案任务会显示在这里。
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="muted text-left text-xs">
              <tr className="border-b border-[var(--border)]">
                <th className="p-2">输出</th>
                <th className="p-2">类型</th>
                <th className="p-2">状态</th>
                <th className="p-2">尝试次数</th>
                <th className="p-2">费用</th>
                <th className="p-2">耗时</th>
                <th className="p-2">创建时间</th>
                <th className="p-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-[var(--border)] align-top last:border-0">
                  <td className="p-2">
                    {j.outputAssetId ? (
                      <AssetImage
                        assetId={j.outputAssetId}
                        alt={`${kindLabel(j.kind)}输出`}
                        className="size-12 rounded"
                      />
                    ) : j.outputDeleted ? (
                      <div className="muted flex size-12 items-center justify-center rounded bg-[var(--panel-2)] text-[10px]">
                        已删除
                      </div>
                    ) : (
                      <div className="size-12 rounded bg-[var(--panel-2)]" />
                    )}
                  </td>
                  <td className="p-2">
                    <Link
                      to="/projects/$projectId/generation/$jobId"
                      params={{ projectId, jobId: j.id }}
                      className="font-medium hover:underline"
                    >
                      {kindLabel(j.kind)}
                    </Link>
                    <div className="muted text-xs">
                      {j.targetType ?? "—"} {j.targetId ? `· ${j.targetId.slice(0, 8)}` : ""} ·{" "}
                      {j.model ?? j.provider ?? ""}
                    </div>
                    {j.failureReason && <div className="mt-1 max-w-md text-xs text-red-500">{j.failureReason}</div>}
                  </td>
                  <td className="p-2">
                    <StatusChip status={j.status} />
                  </td>
                  <td className="p-2">
                    {j.attempts}/{j.maxAttempts}
                  </td>
                  <td className="p-2">{fmt.usd(j.costUsd)}</td>
                  <td className="p-2">{j.latencyMs ? fmt.ms(j.latencyMs) : "—"}</td>
                  <td className="muted p-2 text-xs" title={fmt.date(j.createdAt)}>
                    {fmt.ago(j.createdAt)}
                  </td>
                  <td className="p-2 text-right">
                    <div className="flex justify-end gap-1">
                      {(j.status === "queued" || j.status === "processing") && (
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={cancel.isPending}
                          onClick={() => cancel.mutate(j.id)}
                          aria-label="取消任务"
                        >
                          <XCircle className="size-4" /> 取消
                        </button>
                      )}
                      {(j.status === "failed" || j.status === "cancelled") && (
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={retry.isPending}
                          onClick={() => retry.mutate(j.id)}
                          aria-label="重试任务"
                        >
                          <RotateCcw className="size-4" /> 重试
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pager("mt-3")}
    </div>
  );
}
