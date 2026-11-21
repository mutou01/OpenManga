import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Bot, Check, Copy, KeyRound, ShieldCheck, Trash2, X } from "lucide-react";
import { useState } from "react";
import { del, get, patch, post } from "../../api/client.ts";
import { useAction } from "../../api/hooks.ts";
import {
  ConfirmDialog,
  EmptyState,
  ErrorBox,
  Field,
  fmt,
  Modal,
  PageHeader,
  Spinner,
  StatusChip,
  Tabs,
} from "../../components/ui.tsx";

export type Grant = {
  name: string;
  scopes: string[];
  projectAccess: "all" | "selected";
  projectIds: string[];
  allowProjectCreate: boolean;
  approvalMode: "ALLOW_ALL" | "REQUIRE_APPROVAL";
};

type Info = {
  enabled: boolean;
  endpoint: string;
  issuer: string;
  scopes: { scope: string; description: string }[];
  approvalTtlMinutes: number;
};
type Connection = Omit<Grant, "projectIds"> & {
  id: string;
  kind: "oauth" | "pat" | "app";
  clientId: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  metadata: { declinedScopes?: string[] };
  projects: { id: string; title: string }[];
  tokens: { id: string; hint: string; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null }[];
};
type Approval = {
  id: string;
  status: string;
  tool: string;
  action: string;
  summary: string;
  sensitivity: string;
  estimate: { estimatedUsd?: number | null; count?: number } | null;
  decisionReason: string | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  arguments: Record<string, unknown>;
  connection: { id: string; name: string } | null;
  project: { id: string; title: string } | null;
};
type Rule = {
  id: string;
  actionKey: string;
  decision: "ALLOW" | "DENY";
  connection: string;
  project: string;
  updatedAt: string;
};

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "projects:read": "查看项目及项目元数据。",
  "projects:write": "修改项目设置、状态和元数据，将存储素材移至回收站或删除。",
  "projects:create": "创建新项目。",
  "story:read": "读取故事修订版和分析。",
  "story:write": "创建和编辑故事修订版，应用故事分析。",
  "library:read": "读取角色、场景、道具、风格和参考资料。",
  "library:write": "创建和编辑角色、世界设定、版本、服装、风格和参考资料。",
  "chapters:read": "读取章节、场景、情节节拍和页面。",
  "chapters:write": "创建、编辑和重新规划章节、场景和页面。",
  "panels:read": "读取分镜规格、提示词和图片元数据。",
  "panels:write": "创建、编辑和重排分镜、规格、服装及文字排版。",
  "generations:read": "读取 AI 任务、批次、提示词和生成状态。",
  "generations:run": "启动、重试、回答或控制 AI 和图片生成任务（可能消耗你的提供商额度）。",
  "narration:read": "读取旁白文本、片段、音频状态和时间线。",
  "narration:write": "编辑旁白、请求语音合成和删除旁白音频。",
  "exports:read": "读取导出状态和文件。",
  "exports:create": "将项目导出任务加入队列或删除导出文件。",
  "experts:use": "读取和使用你的专家对话。",
  "usage:read": "读取用量和费用信息。",
  "stats:read": "读取项目关联视频的 YouTube 统计数据。",
};

const keys = {
  info: ["agents", "info"],
  connections: ["agents", "connections"],
  approvals: (v: string) => ["agents", "approvals", v],
  rules: ["agents", "rules"],
} as const;

export const useAgentInfo = () => useQuery({ queryKey: keys.info, queryFn: () => get<Info>("/agents/info") });

/** Scopes, project access, project creation and approval mode: the same form for a token, a connection and consent. */
export function GrantEditor({
  value,
  onChange,
  offered,
  nameLabel = "连接名称",
}: {
  value: Grant;
  onChange: (g: Grant) => void;
  offered?: string[];
  nameLabel?: string;
}) {
  const info = useAgentInfo();
  const projects = useQuery({
    queryKey: ["projects", "all-for-agents"],
    queryFn: () => get<{ projects: { id: string; title: string }[] }>("/projects?status=all"),
  });
  const scopes = (info.data?.scopes ?? []).filter((s) => !offered || offered.includes(s.scope));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className="space-y-4">
      <Field label={nameLabel}>
        <input
          className="input"
          value={value.name}
          maxLength={100}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </Field>
      <ErrorBox error={info.error} title="加载权限失败" onRetry={() => info.refetch()} />
      <fieldset>
        <legend className="label">允许的操作</legend>
        <div className="mb-2 flex gap-2 text-xs">
          <button
            type="button"
            className="btn-ghost px-2 py-1"
            onClick={() => onChange({ ...value, scopes: scopes.map((s) => s.scope) })}
          >
            全选
          </button>
          <button
            type="button"
            className="btn-ghost px-2 py-1"
            onClick={() =>
              onChange({ ...value, scopes: scopes.filter((s) => s.scope.endsWith(":read")).map((s) => s.scope) })
            }
          >
            只读
          </button>
          <button type="button" className="btn-ghost px-2 py-1" onClick={() => onChange({ ...value, scopes: [] })}>
            清空
          </button>
        </div>
        <div className="grid gap-1 sm:grid-cols-2">
          {scopes.map((s) => (
            <label
              key={s.scope}
              className="flex items-start gap-2 rounded px-1 py-0.5 text-sm hover:bg-[var(--panel-2)]"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={value.scopes.includes(s.scope)}
                onChange={() => onChange({ ...value, scopes: toggle(value.scopes, s.scope) })}
              />
              <span>
                <code className="text-xs">{s.scope}</code>
                <span className="muted block text-xs">{SCOPE_DESCRIPTIONS[s.scope] ?? s.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="label">项目</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={value.projectAccess === "selected"}
            onChange={() => onChange({ ...value, projectAccess: "selected" })}
          />
          仅限我选择的项目
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={value.projectAccess === "all"}
            onChange={() => onChange({ ...value, projectAccess: "all" })}
          />
          我的全部项目（包括未来创建的项目）
        </label>
        {value.projectAccess === "selected" && (
          <div className="max-h-48 overflow-y-auto rounded border border-[var(--border)] p-2">
            {projects.isLoading && <Spinner />}
            <ErrorBox error={projects.error} title="加载项目失败" onRetry={() => projects.refetch()} />
            {projects.data?.projects.length === 0 && <p className="muted text-sm">你还没有项目。</p>}
            {projects.data?.projects.map((p) => (
              <label key={p.id} className="flex items-center gap-2 py-0.5 text-sm">
                <input
                  type="checkbox"
                  checked={value.projectIds.includes(p.id)}
                  onChange={() => onChange({ ...value, projectIds: toggle(value.projectIds, p.id) })}
                />
                {p.title}
              </label>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.allowProjectCreate}
            onChange={(e) => onChange({ ...value, allowProjectCreate: e.target.checked })}
          />
          允许创建新项目 {value.projectAccess === "selected" && <span className="muted">（并可访问其创建的项目）</span>}
        </label>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="label">审批</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            className="mt-1"
            checked={value.approvalMode === "REQUIRE_APPROVAL"}
            onChange={() => onChange({ ...value, approvalMode: "REQUIRE_APPROVAL" })}
          />
          <span>
            先询问我 <span className="muted">（推荐）</span>
            <span className="muted block text-xs">
              读取和普通编辑会立即执行。消耗提供商额度、删除、应用分析、锁定版本和导出等操作会在此等待你审批。
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            className="mt-1"
            checked={value.approvalMode === "ALLOW_ALL"}
            onChange={() => onChange({ ...value, approvalMode: "ALLOW_ALL" })}
          />
          <span>
            允许权限范围内的所有操作
            <span className="muted block text-xs">预算、锁定版本和项目访问限制仍然有效。</span>
          </span>
        </label>
      </fieldset>
    </div>
  );
}

const emptyGrant = (name: string): Grant => ({
  name,
  scopes: [],
  projectAccess: "selected",
  projectIds: [],
  allowProjectCreate: false,
  approvalMode: "REQUIRE_APPROVAL",
});

function TokenWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [grant, setGrant] = useState<Grant>(emptyGrant("我的智能体"));
  const [expires, setExpires] = useState<string>("90");
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const info = useAgentInfo();
  const create = useAction(
    () => post<{ token: string }>("/agents/tokens", { ...grant, expiresInDays: expires ? Number(expires) : null }),
    { invalidate: [keys.connections], onSuccess: (r) => setToken(r.token) },
  );
  const close = () => {
    setToken(null);
    setCopied(false);
    setGrant(emptyGrant("我的智能体"));
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      wide
      title={token ? "你的新访问令牌" : "新建个人访问令牌"}
      footer={
        token ? (
          <button type="button" className="btn-primary" onClick={close}>
            完成
          </button>
        ) : (
          <>
            <button type="button" className="btn-secondary" onClick={close}>
              取消
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={create.isPending || !grant.name.trim() || !grant.scopes.length}
              onClick={() => create.mutate()}
            >
              {create.isPending && <Spinner />} 创建令牌
            </button>
          </>
        )
      }
    >
      {token ? (
        <div className="space-y-3 text-sm">
          <p>
            请立即复制。<strong>令牌仅显示这一次</strong>，系统只存储其指纹。若丢失，请撤销此连接并创建新令牌。
          </p>
          <div className="flex items-center gap-2">
            <code className="block flex-1 break-all rounded bg-[var(--panel-2)] p-2 text-xs">{token}</code>
            <button
              type="button"
              className="btn-secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(token);
                setCopied(true);
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "已复制" : "复制"}
            </button>
          </div>
          <p className="muted">
            将智能体连接到 <code>{info.data?.endpoint}</code> （MCP，Streamable HTTP），并使用请求头{" "}
            <code>Authorization: Bearer &lt;token&gt;</code>.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="muted text-sm">
            供其他 MCP 智能体使用。ChatGPT 通过 OAuth
            连接并在此请求授权。智能体会以你的身份，在下方选择的权限范围内操作。
          </p>
          <GrantEditor value={grant} onChange={setGrant} />
          <Field label="有效期">
            <select className="input" value={expires} onChange={(e) => setExpires(e.target.value)}>
              <option value="7">7 天后</option>
              <option value="30">30 天后</option>
              <option value="90">90 天后</option>
              <option value="365">一年后</option>
              <option value="">永不过期</option>
            </select>
          </Field>
        </div>
      )}
    </Modal>
  );
}

function EditConnection({ connection, onClose }: { connection: Connection; onClose: () => void }) {
  const [grant, setGrant] = useState<Grant>({ ...connection, projectIds: connection.projects.map((p) => p.id) });
  const save = useAction(() => patch(`/agents/connections/${connection.id}`, grant), {
    invalidate: [keys.connections],
    success: "连接已更新",
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`编辑 ${connection.name}`}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={save.isPending || !grant.scopes.length}
            onClick={() => save.mutate()}
          >
            {save.isPending && <Spinner />} 保存
          </button>
        </>
      }
    >
      <p className="muted mb-3 text-sm">更改会从下一次调用起生效，缩小权限无需等待令牌过期。</p>
      <GrantEditor value={grant} onChange={setGrant} />
    </Modal>
  );
}

function Connections() {
  const q = useQuery({
    queryKey: keys.connections,
    queryFn: () => get<{ connections: Connection[] }>("/agents/connections"),
  });
  const [wizard, setWizard] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [revoking, setRevoking] = useState<Connection | null>(null);
  const revoke = useAction((id: string) => post(`/agents/connections/${id}/revoke`), {
    invalidate: [keys.connections],
    success: "连接已撤销",
    onSuccess: () => setRevoking(null),
  });
  const info = useAgentInfo();
  return (
    <div className="space-y-3">
      <div className="card space-y-1 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            MCP 端点 <code>{info.data?.endpoint ?? "…"}</code>
          </div>
          <button type="button" className="btn-primary" onClick={() => setWizard(true)}>
            <KeyRound className="size-4" /> 新建访问令牌
          </button>
        </div>
        <p className="muted text-xs">
          在 ChatGPT 中将此地址添加为连接器，通过 OAuth 登录后在此授权。其他智能体使用个人访问令牌。
        </p>
      </div>
      {q.isLoading && <Spinner />}
      <ErrorBox error={info.error} title="加载连接信息失败" onRetry={() => info.refetch()} />
      <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      {q.data?.connections.length === 0 && (
        <EmptyState icon={<Bot className="size-8" />} title="尚未连接智能体">
          使用上方端点连接 ChatGPT，或为其他 MCP 智能体创建个人访问令牌。
        </EmptyState>
      )}
      {q.data?.connections.map((c) => (
        <div key={c.id} className={`card p-4 ${c.revokedAt ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 font-medium">
                {c.name}
                <span className="chip">
                  {c.kind === "oauth" ? "ChatGPT / OAuth" : c.kind === "app" ? "应用内智能体" : "访问令牌"}
                </span>
                {c.revokedAt ? (
                  <StatusChip status="cancelled" label="已撤销" />
                ) : (
                  <StatusChip status="completed" label="有效" />
                )}
              </div>
              <div className="muted mt-1 text-xs">
                连接于 {fmt.date(c.createdAt)} · 最近使用 {fmt.ago(c.lastUsedAt)}
                {c.tokens.map((t) => (
                  <span key={t.id}>
                    {" "}
                    · 令牌 …{t.hint} {t.expiresAt ? `${fmt.date(t.expiresAt)} 过期` : "永不过期"}
                  </span>
                ))}
              </div>
            </div>
            {!c.revokedAt && (
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={() => setEditing(c)}>
                  编辑
                </button>
                <button type="button" className="btn-danger" onClick={() => setRevoking(c)}>
                  撤销
                </button>
              </div>
            )}
          </div>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            <div>
              <div className="label">审批</div>
              {c.approvalMode === "ALLOW_ALL" ? "允许所有操作" : "先询问我"}
            </div>
            <div>
              <div className="label">项目</div>
              {c.projectAccess === "all" ? "全部项目" : c.projects.map((p) => p.title).join(", ") || "尚未选择"}
              {c.allowProjectCreate && " · 可创建项目"}
            </div>
            <div>
              <div className="label">权限范围</div>
              <span className="break-words">{c.scopes.join(", ") || "无"}</span>
              {Boolean(c.metadata?.declinedScopes?.length) && (
                <div className="muted mt-1 break-words">
                  已拒绝（智能体不会再次请求，可编辑授权） {c.metadata.declinedScopes!.join(", ")}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
      <TokenWizard open={wizard} onClose={() => setWizard(false)} />
      {editing && <EditConnection connection={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={Boolean(revoking)}
        title="撤销连接"
        danger
        confirmLabel="撤销"
        busy={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
        onClose={() => setRevoking(null)}
      >
        {revoking?.name} 将立即失去访问权限。其令牌随即失效，所有待审批请求均会取消。
      </ConfirmDialog>
    </div>
  );
}

const APPROVAL_LABELS: Record<string, string> = {
  pending: "待审批",
  executed: "已执行",
  denied: "已拒绝",
  failed: "失败",
  expired: "已过期",
  stale: "目标已变化",
  cancelled: "已取消",
};

const SENSITIVITY: Record<string, string> = {
  spend: "消耗提供商额度",
  delete: "删除",
  "sensitive-write": "敏感修改",
  write: "编辑",
  read: "读取",
};

function ApprovalCard({ a, focused }: { a: Approval; focused: boolean }) {
  const [reason, setReason] = useState("");
  const [showArgs, setShowArgs] = useState(false);
  const decide = useAction(
    (d: { decision: "approve" | "deny"; remember: boolean }) =>
      post<{ approval: Approval }>(`/agents/approvals/${a.id}/decide`, { ...d, reason: reason || undefined }),
    {
      invalidate: [keys.approvals("pending"), keys.approvals("history"), keys.rules],
      success: (r) =>
        r.approval.status === "executed"
          ? "已批准并完成"
          : r.approval.status === "denied"
            ? "已拒绝"
            : r.approval.status === "stale"
              ? "未执行，操作目标已发生变化"
              : r.approval.status === "execution_unknown"
                ? "执行中断，请先确认是否已生效，再尝试重试"
                : `已批准，但执行失败，${r.approval.error?.message ?? r.approval.status}`,
    },
  );
  const pending = a.status === "pending";
  return (
    <div className={`card space-y-2 p-4 ${focused ? "ring-2 ring-accent-500" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip">{SENSITIVITY[a.sensitivity] ?? a.sensitivity}</span>
        <span className="font-medium">{a.summary}</span>
        {!pending && (
          <StatusChip
            status={
              a.status === "executed"
                ? "completed"
                : a.status === "denied"
                  ? "cancelled"
                  : a.status === "failed" || a.status === "execution_unknown"
                    ? "failed"
                    : a.status === "approved"
                      ? "processing"
                      : "queued"
            }
            label={
              a.status === "execution_unknown"
                ? "结果未知"
                : a.status === "approved"
                  ? "执行中"
                  : (APPROVAL_LABELS[a.status] ?? a.status)
            }
          />
        )}
      </div>
      <div className="muted text-xs">
        {a.connection?.name ?? "连接"} · {a.project?.title ?? "无项目"} · <code>{a.action}</code>，通过{" "}
        <code>{a.tool}</code> · {fmt.ago(a.createdAt)}
        {pending && ` · ${fmt.date(a.expiresAt)} 过期`}
        {a.estimate?.estimatedUsd != null && ` · 约 ${fmt.usd(a.estimate.estimatedUsd)}`}
        {a.estimate?.count != null && ` · ${a.estimate.count} 项`}
      </div>
      {a.decisionReason && <p className="text-sm">理由 {a.decisionReason}</p>}
      {a.error && a.status !== "denied" && <p className="text-sm text-red-500">{a.error.message}</p>}
      <button type="button" className="btn-ghost px-1 text-xs" onClick={() => setShowArgs(!showArgs)}>
        {showArgs ? "隐藏原始请求" : "显示原始请求"}
      </button>
      {showArgs && (
        <pre className="max-h-64 overflow-auto rounded bg-[var(--panel-2)] p-2 text-xs">
          {JSON.stringify(a.arguments, null, 2)}
        </pre>
      )}
      {pending && (
        <div className="space-y-2">
          <input
            className="input"
            placeholder="理由（可选，拒绝时会展示给智能体）"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ decision: "approve", remember: false })}
            >
              <Check className="size-4" /> 批准
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={decide.isPending || !a.project}
              title={a.project ? undefined : "仅能记住项目内操作的决定"}
              onClick={() => decide.mutate({ decision: "approve", remember: true })}
            >
              批准，并在此项目中始终允许
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ decision: "deny", remember: false })}
            >
              <X className="size-4" /> 拒绝
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={decide.isPending || !a.project}
              onClick={() => decide.mutate({ decision: "deny", remember: true })}
            >
              拒绝，并在此项目中始终拒绝
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Approvals({ view, focus }: { view: "pending" | "history"; focus?: string }) {
  const q = useQuery({
    queryKey: keys.approvals(view),
    queryFn: () => get<{ approvals: Approval[] }>(`/agents/approvals?view=${view}`),
    refetchInterval: view === "pending" ? 10_000 : false,
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.approvals.length)
    return (
      <EmptyState
        icon={<ShieldCheck className="size-8" />}
        title={view === "pending" ? "暂无待审批请求" : "暂无审批记录"}
      >
        {view === "pending" ? "智能体请求执行敏感操作时，会显示在这里。" : undefined}
      </EmptyState>
    );
  return (
    <div className="space-y-3">
      {q.data.approvals.map((a) => (
        <ApprovalCard key={a.id} a={a} focused={a.id === focus} />
      ))}
    </div>
  );
}

function Rules() {
  const q = useQuery({ queryKey: keys.rules, queryFn: () => get<{ rules: Rule[] }>("/agents/rules") });
  const flip = useAction(
    (r: Rule) => patch(`/agents/rules/${r.id}`, { decision: r.decision === "ALLOW" ? "DENY" : "ALLOW" }),
    {
      invalidate: [keys.rules],
      success: "规则已更改",
    },
  );
  const remove = useAction((id: string) => del(`/agents/rules/${id}`), {
    invalidate: [keys.rules],
    success: "规则已移除，下次会重新询问",
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.rules.length)
    return (
      <EmptyState title="暂无已记住的决定">
        针对连接、项目和操作的“始终允许”与“始终拒绝”决定会显示在这里，可随时修改或移除。
      </EmptyState>
    );
  return (
    <div className="card divide-y divide-[var(--border)]">
      {q.data.rules.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
          <span className={`chip ${r.decision === "ALLOW" ? "bg-green-500/15" : "bg-red-500/15"}`}>
            {r.decision === "ALLOW" ? "始终允许" : "始终拒绝"}
          </span>
          <code className="text-xs">{r.actionKey}</code>
          <span className="muted">
            {r.connection} · {r.project} · {fmt.ago(r.updatedAt)}
          </span>
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn-secondary" disabled={flip.isPending} onClick={() => flip.mutate(r)}>
              改为{r.decision === "ALLOW" ? "拒绝" : "允许"}
            </button>
            <button type="button" className="btn-ghost" aria-label="移除规则" onClick={() => remove.mutate(r.id)}>
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

type Tab = "connections" | "pending" | "history" | "rules";

export function AgentsPage() {
  const search = useSearch({ strict: false }) as { tab?: Tab; request?: string };
  const navigate = useNavigate();
  const tab: Tab = search.tab ?? "connections";
  const pending = useQuery({
    queryKey: keys.approvals("pending"),
    queryFn: () => get<{ approvals: Approval[] }>("/agents/approvals?view=pending"),
  });
  const waiting = pending.data?.approvals.length ?? 0;
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <PageHeader
        title="智能体访问"
        subtitle="管理可代表你操作项目的 AI 智能体（ChatGPT 及其他 MCP 客户端），并查看它们的操作请求。"
      />
      <Tabs<Tab>
        value={tab}
        onChange={(t) => navigate({ to: "/agents", search: { tab: t } })}
        tabs={[
          { value: "connections", label: "连接" },
          { value: "pending", label: waiting ? `待你审批（${waiting}）` : "待你审批" },
          { value: "history", label: "历史记录" },
          { value: "rules", label: "已记住的决定" },
        ]}
      />
      {tab === "connections" && <Connections />}
      {(tab === "pending" || tab === "history") && <Approvals view={tab} focus={search.request} />}
      {tab === "rules" && <Rules />}
    </div>
  );
}
