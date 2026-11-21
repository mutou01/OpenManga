import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { get, post } from "../../api/client.ts";
import { qk, useMe } from "../../api/hooks.ts";
import type { SessionUser } from "../../api/types.ts";
import { ErrorBox, Spinner } from "../../components/ui.tsx";
import { AuthCard } from "./AuthPages.tsx";

type InvitePreview = {
  email: string;
  role: "editor" | "viewer";
  projectTitle: string;
  invitedBy: string | null;
  expiresAt: string;
  accountExists: boolean;
};

/**
 * An emailed invitation link. Signed in to the invited address's account: accept. No account for that address:
 * create one here, which works even when registration is closed. Otherwise: sign in first.
 */
export function InvitePage() {
  const { token } = useSearch({ strict: false }) as { token?: string };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const preview = useQuery({
    queryKey: ["invite-link", token],
    queryFn: () => get<{ invite: InvitePreview }>(`/public/invites/${encodeURIComponent(token ?? "")}`),
    enabled: Boolean(token),
    retry: false,
  });
  const [form, setForm] = useState({ username: "", displayName: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const go = (projectId: string) => navigate({ to: "/projects/$projectId", params: { projectId } });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const accept = () =>
    run(async () => {
      const r = await post<{ projectId: string }>("/invites/accept-link", { token });
      go(r.projectId);
    });
  const signup = (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) return setError(new Error("两次输入的密码不一致"));
    void run(async () => {
      const r = await post<{ user: SessionUser; projectId: string }>("/auth/invite-signup", {
        token,
        username: form.username,
        password: form.password,
        ...(form.displayName.trim() ? { displayName: form.displayName } : {}),
      });
      qc.setQueryData(qk.me, r.user);
      go(r.projectId);
    });
  };
  const home = (
    <Link to="/" className="text-accent-500 hover:underline">
      前往 OpenManga
    </Link>
  );
  if (!token || preview.error)
    return (
      <AuthCard title="邀请不可用" footer={home}>
        <p className="text-sm">此邀请链接无效、已使用、已撤销或已过期。请让项目所有者重新发送邀请。</p>
      </AuthCard>
    );
  if (!preview.data || me.isLoading)
    return (
      <div className="flex min-h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  const inv = preview.data.invite;
  const subtitle = `${inv.invitedBy ? `@${inv.invitedBy}` : "有用户"}邀请 ${inv.email} 以${inv.role === "editor" ? "编辑者" : "查看者"}身份加入“${inv.projectTitle}”。`;
  const signedIn = me.data;
  if (signedIn) {
    const other = signedIn.email !== inv.email;
    return (
      <AuthCard title="加入项目" subtitle={subtitle} footer={home}>
        {other && (
          <p className="mb-3 text-sm">
            当前登录账号为 {signedIn.username}（{signedIn.email}）。请使用 {inv.email} 对应的账号登录后接受邀请。
          </p>
        )}
        <ErrorBox error={error} title="无法接受邀请" />
        <button type="button" className="btn-primary w-full" disabled={busy || other} onClick={accept}>
          {busy && <Spinner />} 接受邀请
        </button>
      </AuthCard>
    );
  }
  if (inv.accountExists)
    return (
      <AuthCard title="加入项目" subtitle={subtitle}>
        <p className="mb-3 text-sm">邮箱 {inv.email} 已有对应账号。登录后即可接受邀请。</p>
        <Link
          to="/login"
          search={{ next: `${window.location.pathname}${window.location.search}` }}
          className="btn-primary w-full justify-center"
        >
          登录
        </Link>
      </AuthCard>
    );
  return (
    <AuthCard title="创建账号" subtitle={subtitle}>
      <form onSubmit={signup} className="space-y-3">
        <div>
          <span className="label">邮箱</span>
          <div className="input muted truncate">{inv.email}</div>
        </div>
        <div>
          <label htmlFor="inv-username" className="label">
            用户名
          </label>
          <input
            id="inv-username"
            className="input"
            autoComplete="username"
            value={form.username}
            onChange={set("username")}
            required
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z0-9_][A-Za-z0-9_.\-]{2,31}"
            title="3–32 个字符，可使用英文字母、数字、下划线、句点和连字符"
          />
        </div>
        <div>
          <label htmlFor="inv-name" className="label">
            显示名称（可选）
          </label>
          <input
            id="inv-name"
            className="input"
            value={form.displayName}
            onChange={set("displayName")}
            maxLength={80}
          />
        </div>
        <div>
          <label htmlFor="inv-pw" className="label">
            密码（至少 10 个字符）
          </label>
          <input
            id="inv-pw"
            className="input"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={set("password")}
            required
            minLength={10}
          />
        </div>
        <div>
          <label htmlFor="inv-pw2" className="label">
            确认密码
          </label>
          <input
            id="inv-pw2"
            className="input"
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={set("confirm")}
            required
            minLength={10}
          />
        </div>
        <ErrorBox error={error} title="无法创建账号" />
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy && <Spinner />} 创建账号并加入
        </button>
      </form>
    </AuthCard>
  );
}
