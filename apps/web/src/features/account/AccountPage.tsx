import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { del, get, patch, post } from "../../api/client.ts";
import { qk, useAction, useMe } from "../../api/hooks.ts";
import type { TtsStatus } from "../../api/types.ts";
import { ErrorBox, Field, fmt, PageHeader, Spinner, toast } from "../../components/ui.tsx";
import { ProviderKeys } from "../ai/AiPicker.tsx";
import { YoutubeChannels } from "../youtube/YoutubePage.tsx";
import { MyActivity } from "./ActivityStats.tsx";

type Session = {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
};

/**
 * Account preferences that seed new projects. A project copies the voice at creation and owns it from then on, so
 * changing this never reaches a project that already exists — that is what the project's own settings are for.
 */
function NarrationDefaults() {
  const { data: me } = useMe();
  const tts = useQuery({ queryKey: ["tts-status"], queryFn: () => get<TtsStatus>("/tts/status") });
  const saved = me?.settings?.narrationVoice ?? "";
  const [voice, setVoice] = useState<string>();
  const value = voice ?? saved;
  const save = useAction((narrationVoice: string) => patch("/auth/settings", { narrationVoice }), {
    invalidate: [qk.me],
    success: "默认旁白音色已保存",
    onSuccess: () => setVoice(undefined),
  });
  const voices = tts.data?.voices ?? [];
  return (
    <section className="card space-y-3 p-4">
      <h2 className="font-medium">旁白</h2>
      <Field label="新项目的默认音色" hint="今后创建的项目将使用此音色。已有项目继续使用创建时的音色。">
        <select
          className="input"
          value={value}
          disabled={save.isPending}
          onChange={(e) => {
            setVoice(e.target.value);
            save.mutate(e.target.value);
          }}
        >
          <option value="">服务器默认值</option>
          {/* A saved voice the server no longer offers stays selectable rather than silently switching. */}
          {saved && !voices.some((v) => v.id === saved) && <option value={saved}>{saved} （不可用）</option>}
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} {v.language ? `· ${v.language}` : ""}
            </option>
          ))}
        </select>
      </Field>
      {!tts.data?.enabled && <p className="muted text-xs">此服务器已禁用语音合成。</p>}
    </section>
  );
}

export function AccountPage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => get<{ sessions: Session[] }>("/auth/sessions") });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const change = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) return setError(new Error("两次输入的密码不一致"));
    setBusy(true);
    setError(null);
    try {
      await post("/auth/password", { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      toast.success("密码已修改，其他会话已退出登录。");
      await sessions.refetch();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <PageHeader
        title="账号"
        subtitle={me ? `${me.username} · ${me.email} · ${me.role === "admin" ? "管理员" : "用户"}` : undefined}
      />
      <NarrationDefaults />
      <ProjectTemplates />
      <ProviderKeys />
      <YoutubeChannels returnTo="/account" />
      <MyActivity />
      <form onSubmit={change} className="card space-y-3 p-4">
        <h2 className="font-medium">修改密码</h2>
        <Field label="当前密码">
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={pw.currentPassword}
            onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
            required
          />
        </Field>
        <Field label="新密码（至少 10 个字符）">
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={pw.newPassword}
            onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
            required
          />
        </Field>
        <Field label="确认新密码">
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={pw.confirm}
            onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
            required
          />
        </Field>
        <ErrorBox error={error} />
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy && <Spinner />} 更新密码
        </button>
      </form>
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">活跃会话</h2>
          <button
            type="button"
            className="btn-danger"
            onClick={async () => {
              try {
                await post("/auth/logout-all");
                qc.clear();
                navigate({ to: "/login", search: {} });
              } catch (e) {
                toast.error(e);
              }
            }}
          >
            退出所有设备
          </button>
        </div>
        {sessions.isLoading && <Spinner />}
        <ul className="divide-y divide-[var(--border)] text-sm">
          {sessions.data?.sessions.map((s) => (
            <li key={s.id} className="py-2">
              <div className="flex items-center gap-2">
                <span className="truncate">{s.userAgent ?? "未知设备"}</span>
                {s.current && <span className="chip bg-accent-600/20">当前设备</span>}
              </div>
              <div className="muted text-xs">
                IP {s.ip ?? "未知"} · 上次使用 {fmt.ago(s.lastUsedAt)} · 到期时间 {fmt.date(s.expiresAt)}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Templates saved from projects' settings; new projects can start from them. */
function ProjectTemplates() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["production-presets"],
    queryFn: () =>
      get<{ templates: { id: string; name: string; format: string; createdAt: string }[] }>("/production-presets"),
  });
  const remove = useAction((id: string) => del(`/auth/templates/${id}`), {
    success: "模板已删除",
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["production-presets"] }),
  });
  if (!list.data?.templates.length) return null;
  return (
    <section className="card space-y-2 p-4">
      <h2 className="font-medium">项目模板</h2>
      <ul className="divide-y divide-[var(--border)] text-sm">
        {list.data.templates.map((t) => (
          <li key={t.id} className="flex items-center gap-2 py-2">
            <span className="mr-auto">
              {t.name}{" "}
              <span className="muted text-xs">
                · {{ comic: "漫画页面", film: "镜头", vertical: "长条漫画" }[t.format] ?? t.format} · 保存于{" "}
                {fmt.ago(t.createdAt)}
              </span>
            </span>
            <button type="button" className="btn-ghost text-xs text-red-500" onClick={() => remove.mutate(t.id)}>
              删除
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
