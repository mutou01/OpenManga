import { buildLabel } from "@openmanga/domain/browser";
import { useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { BarChart3, Bot, Library, LogOut, Menu, MessagesSquare, Moon, Shield, Sun, Tv, User, X } from "lucide-react";
import { useState } from "react";
import { logout, useMe, useMeta } from "../api/hooks.ts";
import { StorageAlert } from "../features/admin/StorageAlert.tsx";
import { NotificationBell } from "../features/comments/NotificationBell.tsx";
import { UI_LOCALE } from "../lib/locale.ts";
import { Logo } from "./Logo.tsx";

const WEB_BUILD = buildLabel(__WEB_BUILD__);

export function AppShell() {
  const { data: me } = useMe();
  const { data: meta } = useMeta();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [menuOpen, setMenuOpen] = useState(false);
  const links = [
    { to: "/series" as const, label: "系列", icon: Library },
    { to: "/profiles" as const, label: "频道配置", icon: Tv },
    { to: "/experts" as const, label: "专家", icon: MessagesSquare },
    { to: "/agents" as const, label: "智能体", icon: Bot },
    { to: "/usage" as const, label: "用量", icon: BarChart3 },
    ...(me?.role === "admin" ? [{ to: "/admin" as const, label: "管理", icon: Shield }] : []),
  ];
  const signOut = async () => {
    setMenuOpen(false);
    await logout().catch(() => {});
    qc.clear();
    navigate({ to: "/login", search: {} });
  };
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("mf-theme", next ? "dark" : "light");
    } catch {}
  };
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-2 sm:gap-3 sm:px-4">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Logo className="size-5 text-accent-500" />
          OpenManga
        </Link>
        {meta?.build && (
          <span
            className="muted hidden font-mono text-[11px] sm:inline"
            title={[
              `服务端 ${meta.build.label}${meta.build.sha ? ` · ${meta.build.sha.slice(0, 7)}` : ""}`,
              `网页端 ${WEB_BUILD}${__WEB_BUILD__.sha ? ` · ${__WEB_BUILD__.sha.slice(0, 7)}` : ""}`,
            ].join("\n")}
          >
            {meta.build.label}
          </span>
        )}
        {meta?.mockMode && (
          <span
            className="chip bg-amber-500/15 text-amber-600 dark:text-amber-300"
            title="使用模拟 AI 服务，不产生 API 费用"
          >
            模拟 AI
          </span>
        )}
        <div className="ml-auto">
          <NotificationBell />
        </div>
        <nav className="hidden items-center gap-1 text-sm sm:flex">
          {links.map((l) => (
            <Link key={l.to} to={l.to} className="btn-ghost" activeProps={{ className: "bg-[var(--panel-2)]" }}>
              <l.icon className="size-4" /> {l.label}
            </Link>
          ))}
          <button type="button" className="btn-ghost" onClick={toggleTheme} aria-label="切换主题">
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <Link to="/account" className="btn-ghost">
            <User className="size-4" /> {me?.username}
          </Link>
          <select aria-label="语言" className="input w-auto shrink-0 py-1 text-sm" defaultValue={UI_LOCALE}>
            <option value={UI_LOCALE}>简体中文</option>
          </select>
          <button type="button" className="btn-ghost" aria-label="退出登录" onClick={signOut}>
            <LogOut className="size-4" />
          </button>
        </nav>
        {/* Phones: the same destinations behind one menu button, with their names spelled out. */}
        <div className="relative sm:hidden">
          <button
            type="button"
            className="btn-ghost"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          {menuOpen && (
            <>
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setMenuOpen(false)}
              />
              <nav className="card absolute right-0 top-11 z-50 flex w-56 flex-col p-1 text-sm shadow-lg">
                {[...links, { to: "/account" as const, label: me?.username ?? "Account", icon: User }].map((l) => (
                  <Link
                    key={l.to}
                    to={l.to}
                    className="btn-ghost justify-start"
                    activeProps={{ className: "bg-[var(--panel-2)]" }}
                    onClick={() => setMenuOpen(false)}
                  >
                    <l.icon className="size-4" /> {l.label}
                  </Link>
                ))}
                <button type="button" className="btn-ghost justify-start" onClick={toggleTheme}>
                  {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}{" "}
                  {dark ? "Light theme" : "Dark theme"}
                </button>
                <button type="button" className="btn-ghost justify-start" onClick={signOut}>
                  <LogOut className="size-4" /> Sign out
                </button>
              </nav>
            </>
          )}
        </div>
      </header>
      {me?.role === "admin" && <StorageAlert />}
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
