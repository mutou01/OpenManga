import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import { get, post } from "../../api/client.ts";
import { qk } from "../../api/hooks.ts";
import type { SessionUser } from "../../api/types.ts";
import { Logo } from "../../components/Logo.tsx";
import { ErrorBox, Spinner } from "../../components/ui.tsx";

type AuthConfig = { registrationEnabled: boolean; devMailboxEnabled: boolean };
const useAuthConfig = () =>
  useQuery({ queryKey: qk.authConfig, queryFn: () => get<AuthConfig>("/auth/config"), staleTime: 300_000 });

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 text-lg font-semibold">
          <Logo className="size-6 text-accent-500" /> OpenManga
        </div>
        <div className="card p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="muted mt-1 text-sm">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer && <div className="muted mt-4 text-center text-sm">{footer}</div>}
      </div>
    </div>
  );
}

function safeNext(next: string | undefined) {
  if (!next) return "/";
  try {
    const u = new URL(next, window.location.origin);
    if (u.origin !== window.location.origin) return "/";
    return u.pathname.replace(/^\/app/, "") + u.search || "/";
  } catch {
    return "/";
  }
}

export function LoginPage() {
  const { next } = useSearch({ strict: false }) as { next?: string };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const cfg = useAuthConfig();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ user: SessionUser }>("/auth/login", { identifier, password });
      qc.setQueryData(qk.me, r.user);
      navigate({ to: safeNext(next) });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard
      title="登录"
      subtitle="使用用户名或邮箱登录。"
      footer={
        cfg.data?.registrationEnabled && (
          <>
            还没有账号？
            <Link to="/register" className="text-accent-500 hover:underline">
              创建账号
            </Link>
          </>
        )
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="identifier" className="label">
            用户名或邮箱
          </label>
          <input
            id="identifier"
            className="input"
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div>
          <label htmlFor="password" className="label">
            密码
          </label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <ErrorBox error={error} title="登录失败" />
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy && <Spinner />} 登录
        </button>
        <div className="flex justify-between text-xs">
          <Link to="/forgot-password" className="muted hover:underline">
            忘记密码？
          </Link>
          {cfg.data?.devMailboxEnabled && (
            <Link to="/dev/mailbox" className="muted hover:underline">
              开发邮箱
            </Link>
          )}
        </div>
      </form>
    </AuthCard>
  );
}

export function RegisterPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const cfg = useAuthConfig();
  const [form, setForm] = useState({ username: "", email: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) return setError(new Error("两次输入的密码不一致"));
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ user: SessionUser }>("/auth/register", {
        username: form.username,
        email: form.email,
        password: form.password,
      });
      qc.setQueryData(qk.me, r.user);
      navigate({ to: "/" });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  if (cfg.data && !cfg.data.registrationEnabled)
    return (
      <AuthCard
        title="注册已关闭"
        footer={
          <Link to="/login" search={{}} className="text-accent-500 hover:underline">
            返回登录
          </Link>
        }
      >
        <p className="text-sm">此服务器的账号由管理员创建。</p>
      </AuthCard>
    );
  return (
    <AuthCard
      title="创建账号"
      footer={
        <>
          已有账号？
          <Link to="/login" search={{}} className="text-accent-500 hover:underline">
            登录
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="username" className="label">
            用户名
          </label>
          <input
            id="username"
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
          <label htmlFor="email" className="label">
            邮箱
          </label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={set("email")}
            required
          />
        </div>
        <div>
          <label htmlFor="pw" className="label">
            密码（至少 10 个字符）
          </label>
          <input
            id="pw"
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
          <label htmlFor="pw2" className="label">
            确认密码
          </label>
          <input
            id="pw2"
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
          {busy && <Spinner />} 创建账号
        </button>
      </form>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const cfg = useAuthConfig();
  const [identifier, setIdentifier] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/auth/password-reset/request", { identifier });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard
      title="重置密码"
      subtitle="系统会发送一次性重置链接。"
      footer={
        <Link to="/login" search={{}} className="text-accent-500 hover:underline">
          返回登录
        </Link>
      }
    >
      {sent ? (
        <div className="space-y-2 text-sm">
          <p>如果该用户名或邮箱对应的账号存在，系统已发送密码重置链接，有效期为 1 小时。</p>
          {cfg.data?.devMailboxEnabled && (
            <p className="muted">
              此服务器使用模拟邮件，邮件保存在
              <Link to="/dev/mailbox" className="text-accent-500 hover:underline">
                开发邮箱
              </Link>
              （生产环境仅管理员可见）。
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor="rid" className="label">
              用户名或邮箱
            </label>
            <input
              id="rid"
              className="input"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoFocus
            />
          </div>
          <ErrorBox error={error} />
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy && <Spinner />} 发送重置链接
          </button>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const { token } = useSearch({ strict: false }) as { token?: string };
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError(new Error("两次输入的密码不一致"));
    setBusy(true);
    setError(null);
    try {
      await post("/auth/password-reset/confirm", { token, password });
      setDone(true);
      setTimeout(() => navigate({ to: "/login", search: {} }), 1500);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  if (!token)
    return (
      <AuthCard
        title="链接无效"
        footer={
          <Link to="/forgot-password" className="text-accent-500 hover:underline">
            申请新链接
          </Link>
        }
      >
        <p className="text-sm">重置链接缺少验证令牌。</p>
      </AuthCard>
    );
  return (
    <AuthCard title="设置新密码" subtitle="更新密码后，所有已登录会话都会退出。">
      {done ? (
        <p className="text-sm">密码已更新，正在返回登录页…</p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor="np" className="label">
              新密码（至少 10 个字符）
            </label>
            <input
              id="np"
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={10}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="np2" className="label">
              确认密码
            </label>
            <input
              id="np2"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={10}
            />
          </div>
          <ErrorBox error={error} />
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy && <Spinner />} 更新密码
          </button>
        </form>
      )}
    </AuthCard>
  );
}
