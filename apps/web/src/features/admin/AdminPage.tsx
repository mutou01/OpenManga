import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { RotateCcw, Search, Shield, UserPlus, Wrench, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { del, get, patch, post, put } from "../../api/client.ts";
import { useAction, useMe } from "../../api/hooks.ts";
import type { GenerationJobRow, UsageSummary, UserRow } from "../../api/types.ts";
import {
  EmptyState,
  ErrorBox,
  Field,
  fmt,
  KeyValue,
  Modal,
  PageHeader,
  Pager,
  Spinner,
  StatusChip,
  Tabs,
} from "../../components/ui.tsx";
import { statusLabel } from "../../lib/locale.ts";
import { AdminActivity } from "../account/ActivityStats.tsx";
import { JOB_STATUSES, JsonBlock, kindLabel } from "../generation/shared.tsx";
import { UsageDashboard } from "../usage/UsageDashboard.tsx";
import { StorageTab } from "./StorageTab.tsx";

type Tab = "overview" | "users" | "jobs" | "usage" | "rates" | "storage" | "activity";
type Overview = {
  counts: Record<string, number>;
  queues: Record<string, Record<string, number>> | null;
  workers:
    | {
        id: string;
        host: string;
        queues: string[];
        capabilities: string[];
        refused: { queue: string; missing: string[] }[];
        version: string | null;
        lastSeen: string;
      }[]
    | null;
  uncovered: { queue: string; waiting: number; needs: string[]; refusedBy: { host: string }[] }[];
  tts: { ok: boolean; state: string; detail?: string };
  disk: { totalBytes: number; freeBytes: number } | null;
  recentErrors: { id: string; source: string; code: string | null; message: string; createdAt: string }[];
  providers: {
    image: { provider: string; model: string; quality: string } | null;
    text: { provider: string; model: string } | null;
  };
  mockMode: boolean;
};

export function AdminPage() {
  const { data: me } = useMe();
  const search = useSearch({ strict: false }) as { tab?: Tab };
  const [tab, setTab] = useState<Tab>(search.tab ?? "overview");
  useEffect(() => {
    if (search.tab) setTab(search.tab);
  }, [search.tab]);
  if (me?.role !== "admin")
    return (
      <div className="p-6">
        <EmptyState icon={<Shield className="size-8" />} title="仅限管理员">
          你无权使用管理工具。
        </EmptyState>
      </div>
    );
  return (
    <div className="mx-auto max-w-7xl overflow-y-auto p-6">
      <PageHeader title="管理" subtitle="运维、账号、生成任务与费用。" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "overview", label: "概览" },
          { value: "users", label: "用户" },
          { value: "jobs", label: "生成任务" },
          { value: "usage", label: "用量" },
          { value: "rates", label: "费率" },
          { value: "storage", label: "存储" },
          { value: "activity", label: "活动" },
        ]}
      />
      {tab === "overview" && <OverviewTab />}
      {tab === "users" && <UsersTab />}
      {tab === "jobs" && <JobsTab />}
      {tab === "usage" && <AdminUsage />}
      {tab === "rates" && <RatesTab />}
      {tab === "storage" && <StorageTab />}
      {tab === "activity" && <AdminActivity />}
    </div>
  );
}

const COUNT_LABELS: Record<string, string> = {
  users: "用户",
  disabledUsers: "已停用用户",
  projects: "项目",
  generationJobs: "生成任务",
  failedJobs: "失败任务",
  activeJobs: "进行中的任务",
  failedAudioJobs: "失败的音频任务",
  failedExports: "失败的导出",
  outboxPending: "待派发任务",
  assets: "素材",
};

function OverviewTab() {
  const q = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => get<Overview>("/admin/overview"),
    refetchInterval: 10_000,
  });
  const maint = useAction(() => post("/admin/maintenance"), { success: "维护任务已加入队列" });
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Spinner />;
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Object.entries(d.counts)
          .filter(([k]) => !k.endsWith("Bytes"))
          .map(([k, v]) => (
            <div key={k} className="card p-3">
              <div className="muted text-xs">{COUNT_LABELS[k] ?? k}</div>
              <div className="text-xl font-semibold">{fmt.num(v)}</div>
            </div>
          ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-2 font-medium">系统</h2>
          <KeyValue
            items={[
              ["模式", d.mockMode ? <StatusChip key="m" status="queued" label="模拟 AI" /> : "真实提供商"],
              [
                "图像提供商",
                d.providers.image
                  ? `${d.providers.image.provider} / ${d.providers.image.model} (${d.providers.image.quality})`
                  : "每位用户自己的密钥",
              ],
              [
                "文本提供商",
                d.providers.text ? `${d.providers.text.provider} / ${d.providers.text.model}` : "每位用户自己的密钥",
              ],
              [
                "Kokoro",
                <span key="k">
                  <StatusChip
                    status={d.tts.ok ? "ready" : d.tts.state === "disabled" ? "draft" : "failed"}
                    label={
                      {
                        disabled: "已禁用",
                        ready: "已就绪",
                        ok: "正常",
                        unavailable: "不可用",
                        error: "错误",
                        degraded: "异常",
                      }[d.tts.state] ?? statusLabel(d.tts.state)
                    }
                  />{" "}
                  {d.tts.detail && <span className="muted text-xs">{d.tts.detail}</span>}
                </span>,
              ],
              ["素材存储", `${fmt.bytes(d.counts.assetBytes)} + ${fmt.bytes(d.counts.variantBytes)} 衍生文件`],
              ["磁盘", d.disk ? `可用 ${fmt.bytes(d.disk.freeBytes)} / 共 ${fmt.bytes(d.disk.totalBytes)}` : "不可用"],
            ]}
          />
          <button
            type="button"
            className="btn-secondary mt-3"
            onClick={() => maint.mutate()}
            disabled={maint.isPending}
          >
            <Wrench className="size-4" /> 立即运行维护
          </button>
        </section>
        <section className="card overflow-x-auto p-4">
          <h2 className="mb-2 font-medium">队列</h2>
          {!d.queues ? (
            <p className="muted text-sm">Redis 不可用</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="muted text-left">
                <tr>
                  {["队列", "工作进程", "等待中", "优先任务", "运行中", "延迟任务", "失败", "已完成"].map((h) => (
                    <th key={h} className="p-1.5 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(d.queues).map(([name, c]) => (
                  <tr key={name} className="border-t border-[var(--border)]">
                    <td className="p-1.5 font-medium">{name}</td>
                    <td className="p-1.5">
                      {d.workers ? d.workers.filter((w) => w.queues.includes(name)).length : "?"}
                    </td>
                    {["waiting", "prioritized", "active", "delayed", "failed", "completed"].map((k) => (
                      <td key={k} className="p-1.5">
                        {c[k] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <section className="card space-y-2 p-4" aria-label="工作进程">
        <h2 className="font-medium">工作进程</h2>
        {d.uncovered
          .filter((u) => u.waiting > 0)
          .map((u) => (
            <p key={u.queue} className="rounded-lg bg-amber-500/10 p-2 text-sm">
              <strong>{u.queue}</strong> 中有 {u.waiting} 个任务等待处理，当前没有运行中的工作进程接收此队列
              {u.needs.length ? `（需要 ${u.needs.join("、")}` : ""}
              {u.needs.length && u.refusedBy.length
                ? `，${u.refusedBy.map((w) => w.host).join("、")} 缺少所需能力）`
                : u.needs.length
                  ? "）"
                  : ""}
              .
            </p>
          ))}
        {!d.workers ? (
          <p className="muted text-sm">Redis 不可用</p>
        ) : !d.workers.length ? (
          <p className="muted text-sm">暂无工作进程上线。</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="muted text-left">
              <tr>
                {["主机", "支持能力", "处理队列", "版本", "上次在线"].map((h) => (
                  <th key={h} className="p-1.5 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.workers.map((w) => (
                <tr key={w.id} className="border-t border-[var(--border)] align-top">
                  <td className="p-1.5 font-medium">{w.host}</td>
                  <td className="p-1.5">{w.capabilities.join(", ") || "—"}</td>
                  <td className="p-1.5">
                    {w.queues.join(", ")}
                    {w.refused.length > 0 && (
                      <span className="muted block">
                        跳过 {w.refused.map((r) => `${r.queue}（缺少 ${r.missing.join("、")}）`).join("、")}
                      </span>
                    )}
                  </td>
                  <td className="p-1.5">{w.version ?? "—"}</td>
                  <td className="p-1.5">{fmt.ago(w.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <CredentialEncryption />
      <section className="card p-4">
        <h2 className="mb-2 font-medium">最近错误</h2>
        {!d.recentErrors.length ? (
          <p className="muted text-sm">暂无错误记录。</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {d.recentErrors.map((e) => (
              <li key={e.id} className="border-b border-[var(--border)] pb-2 last:border-0">
                <div className="muted text-xs">
                  {fmt.date(e.createdAt)} · {e.source}
                  {e.code ? ` · ${e.code}` : ""}
                </div>
                <details>
                  <summary className="cursor-pointer truncate">{e.message.split("\n")[0]}</summary>
                  <pre className="mt-1 overflow-auto text-xs whitespace-pre-wrap">{e.message}</pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type EncryptionStatus = {
  primaryKeyId: string;
  configuredKeyIds: string[];
  byKey: Record<string, number>;
  pending: number;
};

/** API-key encryption: which key encrypts, how many saved keys still use an older key, and a manual rotate. */
function CredentialEncryption() {
  const q = useQuery({
    queryKey: ["admin", "credential-encryption"],
    queryFn: () => get<EncryptionStatus>("/admin/credentials/encryption"),
  });
  const rotate = useAction(() => post<{ rotated: number; failed: number }>("/admin/credentials/rotate"), {
    invalidate: [["admin", "credential-encryption"]],
    success: (r) => `已重新加密 ${r.rotated} 个密钥${r.failed ? `，${r.failed} 个失败，请查看错误或日志` : ""}`,
  });
  if (!q.data) return q.error ? <ErrorBox error={q.error} /> : null;
  const d = q.data;
  return (
    <section className="card p-4">
      <h2 className="mb-2 font-medium">已保存的 API 密钥加密</h2>
      <KeyValue
        items={[
          ["主加密密钥 ID", <code key="p">{d.primaryKeyId}</code>],
          ["可用于解密的密钥", d.configuredKeyIds.join(", ")],
          [
            "各加密密钥对应的已保存密钥数",
            Object.entries(d.byKey).length
              ? Object.entries(d.byKey)
                  .map(([k, n]) => `${k === d.primaryKeyId ? `${k}（主密钥）` : k}: ${n}`)
                  .join(" · ")
              : "无",
          ],
          ["待轮换", d.pending ? <StatusChip key="r" status="queued" label={`${d.pending} 个待重新加密`} /> : "无"],
        ]}
      />
      <p className="muted mt-2 text-xs">
        轮换时设置新的 CREDENTIALS_ENCRYPTION_KEY，将旧密钥移至 CREDENTIALS_ENCRYPTION_OLD_KEYS
        后重启。启动和维护时会执行重新加密，期间新旧密钥均可解密。待轮换数量为 0 后即可移除旧密钥。
      </p>
      <button
        type="button"
        className="btn-secondary mt-3"
        onClick={() => rotate.mutate()}
        disabled={rotate.isPending || !d.pending}
      >
        立即重新加密
      </button>
    </section>
  );
}

type AdminUser = UserRow & { projects: number; lastSeen: string | null };
function UsersTab() {
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ["admin", "users"], queryFn: () => get<{ users: AdminUser[] }>("/admin/users") });
  const update = useAction((v: { id: string; body: Record<string, string> }) => patch(`/admin/users/${v.id}`, v.body), {
    invalidate: [["admin", "users"]],
    success: "用户已更新",
  });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: "", email: "", password: "", role: "user" });
  const create = useAction(() => post("/admin/users", form), {
    invalidate: [["admin", "users"]],
    success: "账号已创建",
    onSuccess: () => {
      setCreating(false);
      setForm({ username: "", email: "", password: "", role: "user" });
    },
  });
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
          <UserPlus className="size-4" /> 创建账号
        </button>
      </div>
      {!q.data ? (
        <Spinner />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="muted text-left text-xs">
              <tr className="border-b border-[var(--border)]">
                {["用户", "角色", "状态", "项目", "上次在线", "创建时间", ""].map((h) => (
                  <th key={h} className="p-2 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.users.map((u) => (
                <tr key={u.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="p-2">
                    <div className="font-medium">{u.username}</div>
                    <div className="muted text-xs">{u.email}</div>
                  </td>
                  <td className="p-2">{u.role === "admin" ? "管理员" : "用户"}</td>
                  <td className="p-2">
                    <StatusChip status={u.status} />
                  </td>
                  <td className="p-2">{u.projects}</td>
                  <td className="muted p-2 text-xs">{fmt.ago(u.lastSeen)}</td>
                  <td className="muted p-2 text-xs">{fmt.date(u.createdAt)}</td>
                  <td className="p-2 text-right">
                    {u.id !== me?.id && (
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() =>
                            update.mutate({ id: u.id, body: { status: u.status === "active" ? "disabled" : "active" } })
                          }
                        >
                          {u.status === "active" ? "停用" : "启用"}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() =>
                            update.mutate({ id: u.id, body: { role: u.role === "admin" ? "user" : "admin" } })
                          }
                        >
                          {u.role === "admin" ? "设为普通用户" : "设为管理员"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="创建账号"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCreating(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>
              {create.isPending && <Spinner />} 创建
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="用户名">
            <input
              className="input"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              autoComplete="off"
            />
          </Field>
          <Field label="邮箱">
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="密码" hint="至少 10 个字符">
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="new-password"
            />
          </Field>
          <Field label="角色">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="user">用户</option>
              <option value="admin">管理员</option>
            </select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}

type AdminJob = Omit<GenerationJobRow, "compiledPrompt"> & { projectTitle: string };
const JOB_PAGE = 100;
function JobsTab() {
  const [status, setStatus] = useState("failed");
  const [page, setPage] = useState(0);
  const [inspect, setInspect] = useState<string | null>(null);
  const key = ["admin", "jobs", status, page];
  const q = useQuery({
    queryKey: key,
    queryFn: () =>
      get<{ jobs: AdminJob[]; total: number }>(
        `/admin/jobs?limit=${JOB_PAGE}&offset=${page * JOB_PAGE}${status ? `&status=${status}` : ""}`,
      ),
    placeholderData: keepPreviousData,
  });
  const pager = (className?: string) => (
    <Pager
      page={page}
      size={JOB_PAGE}
      total={q.data?.total ?? 0}
      onPage={setPage}
      busy={q.isPlaceholderData}
      className={className}
    />
  );
  const retry = useAction((id: string) => post(`/admin/jobs/${id}/retry`), {
    invalidate: [key],
    success: "重试任务已加入队列",
  });
  const cancel = useAction((id: string) => post<{ result: string }>(`/admin/jobs/${id}/cancel`), {
    invalidate: [key],
    success: (r) =>
      `结果 ${{ cancelled: "已取消", cancel_requested: "正在取消", already_finished: "已结束", already_terminal: "已结束" }[r.result] ?? statusLabel(r.result)}`,
  });
  const detail = useQuery({
    queryKey: ["admin", "job", inspect],
    queryFn: () => get<{ job: GenerationJobRow; inputs: unknown[] }>(`/admin/jobs/${inspect}`),
    enabled: Boolean(inspect),
  });
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          className="input w-auto"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
          aria-label="状态筛选"
        >
          <option value="">全部</option>
          {JOB_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        {pager("ml-auto")}
      </div>
      {q.error && <ErrorBox error={q.error} />}
      {!q.data ? (
        <Spinner />
      ) : !q.data.jobs.length ? (
        <EmptyState title="暂无生成任务" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {q.data.jobs.map((j) => (
                <tr key={j.id} className="border-b border-[var(--border)] align-top last:border-0">
                  <td className="p-2">
                    <div className="font-medium">{kindLabel(j.kind)}</div>
                    <div className="muted text-xs">
                      {j.projectTitle} · {fmt.ago(j.createdAt)}
                    </div>
                    {j.failureReason && <div className="text-xs text-red-500">{j.failureReason}</div>}
                  </td>
                  <td className="p-2">
                    <StatusChip status={j.status} />
                  </td>
                  <td className="p-2 text-xs">
                    {j.attempts}/{j.maxAttempts}
                  </td>
                  <td className="p-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button type="button" className="btn-ghost" onClick={() => setInspect(j.id)}>
                        <Search className="size-4" /> 查看详情
                      </button>
                      {(j.status === "failed" || j.status === "cancelled") && (
                        <button type="button" className="btn-ghost" onClick={() => retry.mutate(j.id)}>
                          <RotateCcw className="size-4" /> 重试
                        </button>
                      )}
                      {(j.status === "queued" || j.status === "processing") && (
                        <button type="button" className="btn-ghost" onClick={() => cancel.mutate(j.id)}>
                          <XCircle className="size-4" /> 取消
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
      <Modal open={Boolean(inspect)} onClose={() => setInspect(null)} title="生成任务" wide="xl">
        {detail.error && <ErrorBox error={detail.error} />}
        {!detail.data ? (
          <Spinner />
        ) : (
          <div className="space-y-3">
            <div className="label">编译后的提示词</div>
            <pre className="max-h-80 overflow-auto rounded-lg bg-[var(--panel-2)] p-3 text-xs whitespace-pre-wrap">
              {detail.data.job.compiledPrompt ?? "—"}
            </pre>
            <div className="label">生成任务</div>
            <JsonBlock value={{ ...detail.data.job, compiledPrompt: undefined }} />
            <div className="label">输入</div>
            <JsonBlock value={detail.data.inputs} />
          </div>
        )}
      </Modal>
    </div>
  );
}

function AdminUsage() {
  const q = useQuery({ queryKey: ["admin", "usage"], queryFn: () => get<UsageSummary>("/admin/usage") });
  return (
    <div className="space-y-4">
      <ServerBudget />
      {q.error ? <ErrorBox error={q.error} /> : q.data ? <UsageDashboard data={q.data} /> : <Spinner />}
    </div>
  );
}

type InstanceBudget = {
  limitUsd: number | null;
  source: "admin" | "env" | "无";
  spentUsd: number;
  remainingUsd: number | null;
  exceeded: boolean;
  monthStart: string;
};

/** This month's spend across the whole server against the admin-set ceiling, and the form to change it. */
function ServerBudget() {
  const q = useQuery({
    queryKey: ["admin", "budget"],
    queryFn: () => get<{ budget: InstanceBudget; envDefaultUsd: number | null }>("/admin/budget"),
  });
  const [draft, setDraft] = useState<string | null>(null);
  const save = useAction((monthlyUsd: number | null) => put("/admin/budget", { monthlyUsd }), {
    invalidate: [["admin", "budget"]],
    success: "服务器预算已保存",
    onSuccess: () => setDraft(null),
  });
  const reset = useAction(() => del("/admin/budget"), {
    invalidate: [["admin", "budget"]],
    success: "服务器预算已恢复默认值",
    onSuccess: () => setDraft(null),
  });
  if (!q.data) return q.error ? <ErrorBox error={q.error} /> : null;
  const { budget: b, envDefaultUsd } = q.data;
  const value = draft ?? (b.limitUsd === null ? "" : String(b.limitUsd));
  const pct = b.limitUsd ? Math.min(100, (b.spentUsd / b.limitUsd) * 100) : 0;
  const month = new Date(b.monthStart).toLocaleDateString("zh-CN", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <section className="card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-medium">服务器预算 · {month} (UTC)</h2>
        <span
          className={
            b.exceeded
              ? "chip bg-red-500/15 text-red-600 dark:text-red-300"
              : "chip bg-[var(--panel-2)] text-[var(--text)]"
          }
        >
          {fmt.usd(b.spentUsd)} {b.limitUsd === null ? "已花费，不设上限" : `/ 上限 ${fmt.usd(b.limitUsd)}`}
        </span>
      </div>
      {b.limitUsd !== null && (
        <div
          className="mb-3 h-2 overflow-hidden rounded-full bg-[var(--panel-2)]"
          role="progressbar"
          aria-label="服务器本月支出"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <div
            className={b.exceeded ? "h-full bg-red-500" : pct >= 80 ? "h-full bg-amber-500" : "h-full bg-accent-500"}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <p className="muted mb-3 text-sm">
        此上限限制服务器每个自然月的 AI 总支出，与各项目预算同时生效。达到上限后，将拒绝新的 AI
        任务并暂停排队批次，直到提高上限或进入下个月。任何用户均无法通过确认绕过此限制。
        {b.exceeded && "当前已达到上限。"}
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(value === "" ? null : Math.max(0, Number(value)));
        }}
      >
        <div className="w-44">
          <Field label="每月上限（美元）">
            <input
              className="input"
              type="number"
              min={0}
              step={1}
              placeholder="不设上限"
              value={value}
              onChange={(e) => setDraft(e.target.value)}
            />
          </Field>
        </div>
        <button type="submit" className="btn-primary" disabled={save.isPending || draft === null}>
          保存
        </button>
        {b.source === "admin" && (
          <button type="button" className="btn-secondary" disabled={reset.isPending} onClick={() => reset.mutate()}>
            使用默认值
          </button>
        )}
      </form>
      <p className="muted mt-2 text-xs">
        {b.source === "admin"
          ? "已在此设置。"
          : b.source === "env"
            ? "来自 INSTANCE_BUDGET_USD_MONTHLY。"
            : "尚未设置上限。"}
        环境默认值为 {envDefaultUsd === null ? "无" : fmt.usd(envDefaultUsd)}。清空字段并保存即可取消上限。
      </p>
    </section>
  );
}

type Rate = {
  id: string;
  provider: string;
  model: string;
  effectiveFrom: string;
  textInputRate: string;
  cachedInputRate: string;
  textOutputRate: string;
  imageInputRate: string;
  imageOutputRate: string;
  metadata: { note?: string };
};
const RATE_LABELS = {
  textInputRate: "文本输入",
  cachedInputRate: "缓存输入",
  textOutputRate: "文本输出",
  imageInputRate: "图像输入",
  imageOutputRate: "图像输出",
};
const RATE_FIELDS = [
  "textInputRate",
  "cachedInputRate",
  "textOutputRate",
  "imageInputRate",
  "imageOutputRate",
] as const;
function RatesTab() {
  const q = useQuery({ queryKey: ["admin", "rates"], queryFn: () => get<{ rates: Rate[] }>("/admin/rates") });
  const [f, setF] = useState({
    provider: "openai",
    model: "gpt-image-2",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    textInputRate: 0,
    cachedInputRate: 0,
    textOutputRate: 0,
    imageInputRate: 0,
    imageOutputRate: 0,
    note: "",
  });
  const add = useAction(() => post("/admin/rates", { ...f, effectiveFrom: new Date(f.effectiveFrom).toISOString() }), {
    invalidate: [["admin", "rates"]],
    success: "费率快照已添加",
  });
  return (
    <div className="space-y-4">
      <p className="muted text-sm">
        费率为可编辑的估算值，单位为美元/百万词元。费用根据提供商记录的词元用量及调用时生效的费率快照计算，价格变更时请添加新快照。
      </p>
      {q.error && <ErrorBox error={q.error} />}
      {q.data && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="muted text-left text-xs">
              <tr className="border-b border-[var(--border)]">
                {["提供商", "模型", "生效日期", "文本输入", "缓存输入", "文本输出", "图像输入", "图像输出", "备注"].map(
                  (h) => (
                    <th key={h} className="p-2 font-normal">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {q.data.rates.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="p-2">{r.provider}</td>
                  <td className="p-2">{r.model}</td>
                  <td className="p-2 text-xs">{fmt.date(r.effectiveFrom)}</td>
                  {RATE_FIELDS.map((k) => (
                    <td key={k} className="p-2">
                      ${Number(r[k])}
                    </td>
                  ))}
                  <td className="muted p-2 text-xs">{r.metadata.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form
        className="card grid gap-3 p-4 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label="提供商">
          <input
            className="input"
            value={f.provider}
            onChange={(e) => setF({ ...f, provider: e.target.value })}
            required
          />
        </Field>
        <Field label="模型">
          <input className="input" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} required />
        </Field>
        <Field label="生效日期">
          <input
            className="input"
            type="date"
            value={f.effectiveFrom}
            onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })}
            required
          />
        </Field>
        <Field label="备注">
          <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        {RATE_FIELDS.map((k) => (
          <Field key={k} label={`${RATE_LABELS[k]}（美元/百万词元）`}>
            <input
              className="input"
              type="number"
              step="0.000001"
              min={0}
              value={f[k]}
              onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })}
            />
          </Field>
        ))}
        <div className="flex items-end">
          <button type="submit" className="btn-primary w-full" disabled={add.isPending}>
            {add.isPending && <Spinner />} 添加快照
          </button>
        </div>
      </form>
    </div>
  );
}
