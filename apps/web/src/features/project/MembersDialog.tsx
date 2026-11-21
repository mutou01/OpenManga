import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, Trash2, UserPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { del, get, patch, post } from "../../api/client.ts";
import { useAction, useMe } from "../../api/hooks.ts";
import { ErrorBox, Field, fmt, Modal, Spinner } from "../../components/ui.tsx";

export type Member = {
  userId: string;
  username: string;
  displayName: string | null;
  role: "owner" | "editor" | "viewer";
  createdAt: string;
};
type Invite = {
  id: string;
  role: "editor" | "viewer";
  email: string | null;
  username: string | null;
  invitedBy: string | null;
  expiresAt: string;
};

export const membersKey = (projectId: string) => ["project", projectId, "members"] as const;

export function useMembers(projectId: string, enabled = true) {
  return useQuery({
    queryKey: membersKey(projectId),
    queryFn: () => get<{ members: Member[]; invites: Invite[]; canManage: boolean }>(`/projects/${projectId}/members`),
    enabled,
  });
}

const ROLE_HELP = "编辑者可以修改项目，并使用自己的服务商密钥生成内容。查看者可以阅读和评论。";

/** Who is on the project: the owner invites, changes roles and removes; everyone else sees the list and can leave. */
export function MembersDialog({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const key = membersKey(projectId);
  const q = useMembers(projectId, open);
  const { data: me } = useMe();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const invite = useAction(() => post(`/projects/${projectId}/invites`, { identifier, role }), {
    invalidate: [key],
    success: identifier.includes("@") ? "已通过邮件发送邀请" : "已发送邀请",
    onSuccess: () => setIdentifier(""),
  });
  const revoke = useAction((id: string) => del(`/invites/${id}`), { invalidate: [key], success: "已撤销邀请" });
  const setMemberRole = useAction(
    (v: { userId: string; role: string }) => patch(`/projects/${projectId}/members/${v.userId}`, { role: v.role }),
    { invalidate: [key], success: "已更新权限" },
  );
  const remove = useAction((userId: string) => del(`/projects/${projectId}/members/${userId}`), {
    invalidate: [key, ["projects"]],
    onSuccess: (_r, userId) => {
      if (userId === me?.id) navigate({ to: "/" });
    },
    success: "已移除",
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (identifier.trim()) invite.mutate();
  };
  const manage = q.data?.canManage;
  return (
    <Modal open={open} onClose={onClose} title="成员">
      <div className="space-y-4">
        {manage && (
          <form onSubmit={submit} className="space-y-2">
            <p className="muted text-sm">{ROLE_HELP}</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 basis-48">
                <Field label="用户名或邮箱">
                  <input
                    className="input"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="例如 alex 或 alex@example.com"
                    autoComplete="off"
                  />
                </Field>
              </div>
              <Field label="权限">
                <select className="input" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                  <option value="editor">编辑者</option>
                  <option value="viewer">查看者</option>
                </select>
              </Field>
              <button type="submit" className="btn-primary" disabled={invite.isPending || !identifier.trim()}>
                {invite.isPending ? <Spinner /> : <UserPlus className="size-4" />} 邀请
              </button>
            </div>
          </form>
        )}
        {q.isLoading && <Spinner />}
        <ErrorBox error={q.error} />
        <ul className="divide-y divide-[var(--border)]">
          {q.data?.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <div className="mr-auto min-w-0">
                <div className="truncate font-medium">
                  {m.displayName || m.username}
                  {m.userId === me?.id && <span className="muted font-normal">（你）</span>}
                </div>
                <div className="muted truncate text-xs">
                  @{m.username} · {fmt.ago(m.createdAt)}加入
                </div>
              </div>
              {manage && m.role !== "owner" ? (
                <select
                  className="input w-auto"
                  aria-label={`${m.username} 的权限`}
                  value={m.role}
                  disabled={setMemberRole.isPending}
                  onChange={(e) => setMemberRole.mutate({ userId: m.userId, role: e.target.value })}
                >
                  <option value="editor">编辑者</option>
                  <option value="viewer">查看者</option>
                </select>
              ) : (
                <span className="chip capitalize">
                  {m.role === "owner" ? "所有者" : m.role === "editor" ? "编辑者" : "查看者"}
                </span>
              )}
              {m.role !== "owner" && (manage || m.userId === me?.id) && (
                <button
                  type="button"
                  className="btn-secondary"
                  title={m.userId === me?.id ? "退出项目" : "移除"}
                  aria-label={m.userId === me?.id ? "退出项目" : `移除 ${m.username}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(m.userId)}
                >
                  {m.userId === me?.id ? <LogOut className="size-4" /> : <Trash2 className="size-4" />}
                </button>
              )}
            </li>
          ))}
        </ul>
        {manage && Boolean(q.data?.invites.length) && (
          <div>
            <h3 className="mb-1 text-sm font-medium">待接受的邀请</h3>
            <ul className="divide-y divide-[var(--border)]">
              {q.data?.invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <div className="mr-auto min-w-0">
                    <div className="truncate">{i.email ?? `@${i.username}`}</div>
                    <div className="muted text-xs">
                      <span className="capitalize">{i.role === "editor" ? "编辑者" : "查看者"}</span> ·{" "}
                      {fmt.date(i.expiresAt)} 到期
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    title="撤销"
                    aria-label="撤销邀请"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(i.id)}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
