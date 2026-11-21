import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Check, ExternalLink, RotateCcw, Upload, XCircle } from "lucide-react";
import { useState } from "react";
import { assetUrl, get, post } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import type { JobDetail } from "../../api/types.ts";
import { AssetImage, ErrorBox, fmt, KeyValue, PageHeader, Spinner, StatusChip, toast } from "../../components/ui.tsx";
import { useProjectId } from "../project/ProjectLayout.tsx";
import { CopyButton, JsonBlock, kindLabel } from "./shared.tsx";

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const DOCS_URL = "https://github.com/pr0h0/OpenManga/blob/master/docs/WITHOUT_API_KEYS.md";
const FORMATS_URL = "https://github.com/pr0h0/OpenManga/blob/master/docs/ANSWER_FORMATS.md";

/**
 * The other half of a keyless run: the prompt is above, this is where the answer comes back. Held to exactly the
 * schema a provider's answer is, so a rejected paste explains itself and can simply be pasted again.
 */
export function ManualAnswer({
  jobId,
  lastError,
  attachments,
  answered,
  onSubmitted,
}: {
  jobId: string;
  lastError: string | null;
  attachments: string[];
  answered: number;
  onSubmitted: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // Refetched per question: a plan's outline and its scenes each want a differently shaped answer.
  const guide = useQuery({
    queryKey: [...qk.job(jobId), "manual", answered],
    queryFn: () =>
      get<{ example: string | null; format: { name: string; interface: string } | null }>(
        `/generations/${jobId}/manual`,
      ),
  });
  const send = async (answer: string) => {
    if (!answer.trim()) return;
    setBusy(true);
    try {
      await post(`/generations/${jobId}/manual`, { text: answer.trim() });
      toast.success("回答已提交，正在校验数据结构");
      setText("");
      onSubmitted();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card border-amber-500/40 p-4">
      <h2 className="mb-1 font-medium">等待你的回答{answered > 0 ? ` · 第 ${answered + 1} 个问题` : ""}</h2>
      <p className="muted mb-3 text-sm">
        将下方编译后的提示词复制到聊天工具，再将回答粘贴到这里。系统会按提供商回答相同的数据结构进行校验，通过后才会应用。
      </p>
      {attachments.length > 0 && (
        <div className="mb-3 rounded-lg bg-[var(--panel-2)] p-3 text-sm">
          <p className="mb-2">
            此问题涉及 {attachments.length} 张图片。请下载图片并附加到聊天中，提示词已标明各图的位置。
          </p>
          <div className="flex flex-wrap gap-2">
            {attachments.map((id, n) => (
              <a key={id} href={assetUrl(id)} download target="_blank" rel="noreferrer" className="text-center text-xs">
                <AssetImage assetId={id} alt={`图片 ${n + 1}`} className="size-24 rounded object-cover" />
                图片 {n + 1}
              </a>
            ))}
          </div>
        </div>
      )}
      {lastError && (
        <p className="mb-3 rounded-lg bg-red-500/10 p-2 font-mono text-xs break-words text-red-500">{lastError}</p>
      )}
      <details className="mb-3 rounded-lg border border-[var(--border)] p-2 text-sm">
        <summary className="cursor-pointer font-medium">回答应采用什么格式？</summary>
        <div className="mt-2 space-y-2">
          <p className="muted">
            回答需使用符合提示词末尾结构的 JSON。可以用代码块或说明文字包裹，系统只读取
            JSON。下方示例用于展示当前问题的回答结构，示例内容为占位内容，请粘贴聊天工具针对你的故事生成的回答。
          </p>
          {guide.data?.format && (
            <>
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  <code>{guide.data.format.name}</code> — 各字段的含义、填写内容与示例值
                </span>
                <CopyButton text={guide.data.format.interface} />
              </div>
              <pre className="max-h-[28rem] overflow-auto rounded-lg bg-[var(--panel-2)] p-2 font-mono text-xs">
                {guide.data.format.interface}
              </pre>
              <span className="font-medium">当前问题的有效回答示例</span>
            </>
          )}
          {guide.data?.example ? (
            <>
              <div className="flex justify-end">
                <CopyButton text={guide.data.example} />
              </div>
              <pre className="max-h-72 overflow-auto rounded-lg bg-[var(--panel-2)] p-2 font-mono text-xs">
                {guide.data.example}
              </pre>
            </>
          ) : (
            <p className="muted text-xs">{guide.isLoading ? "正在加载示例…" : "此问题暂无示例。"}</p>
          )}
          <p className="text-xs">
            查看各类回答格式的字段说明{" "}
            <a href={FORMATS_URL} target="_blank" rel="noreferrer" className="text-accent-500 hover:underline">
              回答格式
            </a>
            。完整流程说明{" "}
            <a href={DOCS_URL} target="_blank" rel="noreferrer" className="text-accent-500 hover:underline">
              无需 API 密钥的使用方式
            </a>
            .
          </p>
        </div>
      </details>
      <textarea
        className="input min-h-40 font-mono text-xs"
        placeholder="粘贴模型的 JSON 回答，可使用代码块包裹"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" disabled={busy || !text.trim()} onClick={() => send(text)}>
          {busy ? <Spinner /> : <Check className="size-4" />} 提交回答
        </button>
        <label className="btn-secondary cursor-pointer">
          <Upload className="size-4" /> 上传文件
          <input
            type="file"
            className="sr-only"
            accept=".json,.txt,application/json,text/plain"
            disabled={busy}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) await send(await f.text());
            }}
          />
        </label>
      </div>
    </section>
  );
}

export function JobDetailPage() {
  const projectId = useProjectId();
  const { jobId } = useParams({ strict: false }) as { jobId: string };
  const q = useQuery({
    queryKey: qk.job(jobId),
    queryFn: () => get<JobDetail>(`/generations/${jobId}`),
    refetchInterval: (query) =>
      ["queued", "processing", "cancel_requested"].includes(query.state.data?.job.status ?? "") ? 3000 : false,
  });
  const cancel = useAction(() => post<{ result: string }>(`/generations/${jobId}/cancel`), {
    invalidate: [qk.job(jobId), qk.generations(projectId)],
    success: (r) => (r.result === "cancelled" ? "已取消" : "已请求取消"),
  });
  const restore = useAction((assetId: string) => post(`/assets/${assetId}/restore`), {
    invalidate: [qk.job(jobId), qk.generations(projectId), qk.assets(projectId)],
    success: "图片已恢复",
  });
  const retry = useAction(() => post<{ job: { id: string } }>(`/generations/${jobId}/retry`), {
    invalidate: [qk.job(jobId), qk.generations(projectId)],
    success: "已创建新的重试任务并加入队列",
  });

  if (q.isLoading)
    return (
      <div className="p-6">
        <Spinner />
      </div>
    );
  if (q.error)
    return (
      <div className="p-6">
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      </div>
    );
  const { job, inputs, outputs, usage, retries, totals } = q.data!;
  const pageId = str(job.input.pageId);
  const promptInput = job.input as Record<string, unknown>;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <Link to="/projects/$projectId/generation" params={{ projectId }} className="muted text-xs hover:underline">
        ← 生成任务队列
      </Link>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {kindLabel(job.kind)} <StatusChip status={job.status} />
          </span>
        }
        subtitle={`任务 ${job.id}`}
        actions={
          <>
            {(job.status === "queued" || job.status === "processing" || job.status === "awaiting_input") && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => cancel.mutate()}
                disabled={cancel.isPending}
              >
                <XCircle className="size-4" /> 取消
              </button>
            )}
            {(job.status === "failed" || job.status === "cancelled") && (
              <button type="button" className="btn-primary" onClick={() => retry.mutate()} disabled={retry.isPending}>
                <RotateCcw className="size-4" /> 重试
              </button>
            )}
          </>
        }
      />
      {job.failureReason && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300"
        >
          <span className="font-medium">{job.failureCode ?? "失败"}：</span> {job.failureReason}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-3 font-medium">请求</h2>
          <KeyValue
            items={[
              [
                "目标",
                job.targetType === "panel" && pageId ? (
                  <Link
                    key="t"
                    to="/projects/$projectId/pages/$pageId"
                    params={{ projectId, pageId }}
                    search={{ panelId: job.targetId ?? undefined }}
                    className="text-accent-500 hover:underline"
                  >
                    画格 {job.targetId?.slice(0, 8)}
                  </Link>
                ) : (
                  `${job.targetType ?? "—"} ${job.targetId ?? ""}`
                ),
              ],
              ["提供商 / 模型", `${job.provider ?? "—"} / ${job.model ?? "—"}`],
              ["质量", String(job.parameters.quality ?? "—")],
              ["模板", job.templateName ? `${job.templateName} v${job.templateVersion ?? "?"}` : "—"],
              [
                "提示词哈希",
                <code key="p" className="text-xs">
                  {job.promptHash ?? "—"}
                </code>,
              ],
              [
                "参考素材哈希",
                <code key="r" className="text-xs">
                  {job.referencesHash ?? "—"}
                </code>,
              ],
              [
                "选项哈希",
                <code key="o" className="text-xs">
                  {job.optionsHash ?? "—"}
                </code>,
              ],
              [
                "提供商请求 ID",
                <code key="q" className="text-xs">
                  {job.providerRequestId ?? "—"}
                </code>,
              ],
              ["优先级 / 尝试次数", `${job.priority} / ${job.attempts} 次（最多 ${job.maxAttempts} 次）`],
              ["创建时间", fmt.date(job.createdAt)],
              ["开始时间", fmt.date(job.startedAt)],
              ["结束时间", fmt.date(job.finishedAt)],
              ["耗时", job.latencyMs ? fmt.ms(job.latencyMs) : "—"],
            ]}
          />
        </section>
        <section className="card p-4">
          <h2 className="mb-3 font-medium">参数与结构化输入</h2>
          <KeyValue
            items={[
              [
                "角色版本",
                Array.isArray(promptInput.characterVersionIds)
                  ? (promptInput.characterVersionIds as string[]).map((v) => v.slice(0, 8)).join(", ") || "none"
                  : "—",
              ],
              ["场景版本", str(promptInput.locationVersionId)?.slice(0, 8) ?? "—"],
              ["风格", str(promptInput.styleId)?.slice(0, 8) ?? "—"],
            ]}
          />
          <div className="mt-3 space-y-2">
            <div className="label">参数</div>
            <JsonBlock value={job.parameters} maxHeight="12rem" />
            <details>
              <summary className="muted cursor-pointer text-xs">完整任务输入</summary>
              <JsonBlock value={job.input} />
            </details>
          </div>
        </section>
      </div>

      {job.status === "awaiting_input" && (
        <ManualAnswer
          jobId={job.id}
          lastError={job.failureReason}
          attachments={
            Array.isArray(job.parameters.manualAttachments) ? (job.parameters.manualAttachments as string[]) : []
          }
          answered={Array.isArray(job.parameters.manualAnswers) ? job.parameters.manualAnswers.length : 0}
          onSubmitted={() => q.refetch()}
        />
      )}

      <section className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-medium">编译后的提示词</h2>
          {job.compiledPrompt && <CopyButton text={job.compiledPrompt} />}
        </div>
        {job.compiledPrompt ? (
          <pre className="max-h-[32rem] overflow-auto rounded-lg bg-[var(--panel-2)] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {job.compiledPrompt}
          </pre>
        ) : (
          <p className="muted text-sm">尚未记录，文本任务会在调用提供商时记录消息。</p>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-3 font-medium">已发送图片（{inputs.length}）</h2>
        {!inputs.length ? (
          <p className="muted text-sm">未附加参考图。</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {inputs.map((i) => {
              const m = i.metadata as {
                canonicalWidth?: number;
                canonicalHeight?: number;
                maxWidth?: number;
                maxHeight?: number;
                referenceBytes?: number;
              };
              return (
                <div key={i.id} className="flex gap-3 rounded-lg border border-[var(--border)] p-2">
                  <AssetImage assetId={i.assetId} alt={i.label} className="size-20 shrink-0 rounded" fit="contain" />
                  <div className="min-w-0 text-xs">
                    <div className="font-medium">
                      #{i.order + 1} {i.role.replace(/_/g, " ")}
                    </div>
                    <div className="muted truncate" title={i.label}>
                      {i.label}
                    </div>
                    {i.sentAs === "prompt_ref_derivative" ? (
                      <div className="mt-1 text-emerald-600 dark:text-emerald-400">
                        以缩略派生图发送 {i.width}×{i.height}
                        {m.maxWidth ? `（最大 ${m.maxWidth}×${m.maxHeight}）` : ""}
                        {m.referenceBytes || i.variant
                          ? ` · ${fmt.bytes(m.referenceBytes ?? i.variant?.byteSize)}`
                          : ""}
                      </div>
                    ) : (
                      <div className="mt-1 text-sky-600 dark:text-sky-400">
                        以原始分辨率发送 {i.width}×{i.height}
                      </div>
                    )}
                    {m.canonicalWidth && (
                      <div className="muted">
                        原始尺寸 {m.canonicalWidth}×{m.canonicalHeight}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {outputs.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-3 font-medium">输出结果</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {outputs.map((o) => (
              <div key={o.id}>
                {o.deleted ? (
                  <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg bg-[var(--panel-2)] text-sm">
                    <span className="muted">此图片已删除，在清空回收站前可以恢复。</span>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={restore.isPending}
                      onClick={() => restore.mutate(o.assetId)}
                    >
                      <RotateCcw className="size-4" /> 恢复图片
                    </button>
                  </div>
                ) : (
                  <>
                    <a href={assetUrl(o.assetId)} target="_blank" rel="noreferrer">
                      <AssetImage
                        assetId={o.assetId}
                        variant={null}
                        alt="生成结果"
                        className="max-h-[28rem] w-full rounded-lg"
                        fit="contain"
                      />
                    </a>
                    <div className="mt-1 flex items-center gap-2 text-xs">
                      {o.activated ? (
                        <StatusChip status="approved" label="已启用" />
                      ) : (
                        <StatusChip status="draft" label="未启用" />
                      )}
                      <a
                        className="text-accent-500 hover:underline"
                        href={assetUrl(o.assetId)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看原图 <ExternalLink className="inline size-3" />
                      </a>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card overflow-x-auto p-4">
        <h2 className="mb-3 font-medium">用量（{fmt.usd(totals.costUsd)}）</h2>
        {!usage.length ? (
          <p className="muted text-sm">暂无提供商用量记录。</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="muted text-left">
              <tr className="border-b border-[var(--border)]">
                {[
                  "提供商",
                  "模型",
                  "操作",
                  "用途",
                  "文本输入",
                  "文本输出",
                  "图片输入",
                  "图片输出",
                  "缓存",
                  "费用",
                  "耗时",
                  "请求 ID",
                ].map((h) => (
                  <th key={h} className="p-1.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="p-1.5">{u.provider}</td>
                  <td className="p-1.5">{u.model}</td>
                  <td className="p-1.5">{u.operation}</td>
                  <td className="p-1.5">{String((u.metadata as { purpose?: string }).purpose ?? "—")}</td>
                  <td className="p-1.5">{fmt.num(u.textInputTokens)}</td>
                  <td className="p-1.5">{fmt.num(u.textOutputTokens)}</td>
                  <td className="p-1.5">{fmt.num(u.imageInputTokens)}</td>
                  <td className="p-1.5">{fmt.num(u.imageOutputTokens)}</td>
                  <td className="p-1.5">{fmt.num(u.cachedInputTokens)}</td>
                  <td className="p-1.5">{fmt.usd(u.estimatedCostUsd)}</td>
                  <td className="p-1.5">{fmt.ms(u.latencyMs)}</td>
                  <td className="p-1.5">
                    <code>{u.requestId ?? "—"}</code>
                  </td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="p-1.5" colSpan={4}>
                  合计
                </td>
                <td className="p-1.5">{fmt.num(totals.textInputTokens)}</td>
                <td className="p-1.5">{fmt.num(totals.textOutputTokens)}</td>
                <td className="p-1.5">{fmt.num(totals.imageInputTokens)}</td>
                <td className="p-1.5">{fmt.num(totals.imageOutputTokens)}</td>
                <td className="p-1.5" />
                <td className="p-1.5">{fmt.usd(totals.costUsd)}</td>
                <td className="p-1.5" colSpan={2} />
              </tr>
            </tbody>
          </table>
        )}
        {usage[0]?.rawUsage && (
          <details className="mt-2">
            <summary className="muted cursor-pointer text-xs">提供商原始用量</summary>
            <JsonBlock value={usage.map((u) => u.rawUsage)} />
          </details>
        )}
      </section>

      {retries.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 font-medium">重试记录</h2>
          <ul className="space-y-1 text-sm">
            {retries.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <Link
                  to="/projects/$projectId/generation/$jobId"
                  params={{ projectId, jobId: r.id }}
                  className="text-accent-500 hover:underline"
                >
                  {r.id.slice(0, 8)}
                </Link>
                <StatusChip status={r.status} /> <span className="muted text-xs">{fmt.ago(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
