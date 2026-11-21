import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  Check,
  Copy,
  Download,
  FolderOpen,
  LogOut,
  MailOpen,
  MoreVertical,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { del, get, post } from "../../api/client.ts";
import { useAction, useMe } from "../../api/hooks.ts";
import type { ProjectListItem } from "../../api/types.ts";
import {
  AssetImage,
  ConfirmDialog,
  EmptyState,
  ErrorBox,
  fmt,
  PageHeader,
  Popover,
  Spinner,
  StatusChip,
  Tabs,
  toast,
} from "../../components/ui.tsx";
import { projectTypeLabel } from "../../lib/locale.ts";

type Filter = "active" | "archived" | "trash";

export function DashboardPage() {
  const [filter, setFilter] = useState<Filter>("active");
  const q = useQuery({
    queryKey: ["projects", filter],
    queryFn: () => get<{ projects: ProjectListItem[] }>(`/projects?status=${filter}`),
  });
  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <PageHeader
        title="项目"
        subtitle="整理故事设定，保持角色一致，精确控制排字。"
        actions={
          <div className="flex gap-2">
            <ImportProjectButton />
            <Link to="/projects/new" className="btn-primary">
              <Plus className="size-4" /> 新建项目
            </Link>
          </div>
        }
      />
      <Tabs
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: "active", label: "最近" },
          { value: "archived", label: "已归档" },
          { value: "trash", label: "回收站" },
        ]}
      />
      <PendingInvites />
      {q.isLoading && <Spinner className="size-6" />}
      <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      {q.data && q.data.projects.length === 0 && (
        <EmptyState
          title={filter === "active" ? "还没有项目" : filter === "archived" ? "没有已归档的项目" : "回收站为空"}
          action={
            filter === "active" && (
              <Link to="/projects/new" className="btn-primary">
                <Plus className="size-4" /> 创建第一个项目
              </Link>
            )
          }
        >
          {filter === "active" && "粘贴故事，提取角色与世界设定，制作参考图，规划页面并生成画格。"}
        </EmptyState>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {q.data?.projects.map((p) => (
          <ProjectCard key={p.id} p={p} filter={filter} />
        ))}
      </div>
    </div>
  );
}

type Invite = {
  id: string;
  role: "editor" | "viewer";
  projectId: string;
  projectTitle: string;
  invitedBy: string | null;
  expiresAt: string;
};

/** Invitations to other people's projects, answered here. */
function PendingInvites() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["invites"], queryFn: () => get<{ invites: Invite[] }>("/invites") });
  const answer = useAction(
    (v: { id: string; accept: boolean }) =>
      post<{ projectId?: string }>(`/invites/${v.id}/${v.accept ? "accept" : "decline"}`),
    {
      invalidate: [["invites"], ["projects"]],
      onSuccess: (r) => {
        if (r.projectId) navigate({ to: "/projects/$projectId", params: { projectId: r.projectId } });
      },
    },
  );
  if (!q.data?.invites.length) return null;
  return (
    <section className="card mb-4 p-3" aria-label="项目邀请">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
        <MailOpen className="size-4" /> 项目邀请
      </h2>
      <ul className="divide-y divide-[var(--border)]">
        {q.data.invites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <div className="mr-auto min-w-0">
              <div className="truncate font-medium">{i.projectTitle}</div>
              <div className="muted text-xs">
                {i.invitedBy ? `@${i.invitedBy}` : "有用户"}邀请你成为{i.role === "editor" ? "编辑者" : "查看者"} ·{" "}
                {fmt.date(i.expiresAt)} 到期
              </div>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={answer.isPending}
              onClick={() => answer.mutate({ id: i.id, accept: true })}
            >
              <Check className="size-4" /> 接受
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={answer.isPending}
              onClick={() => answer.mutate({ id: i.id, accept: false })}
            >
              <X className="size-4" /> 拒绝
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ImportProjectButton() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      // Sent as a raw body: multipart would buffer the whole package, and a project export can be over a gigabyte.
      const r = await post<{ project: { id: string } }>(`/projects/import?name=${encodeURIComponent(file.name)}`, file);
      toast.success("已开始导入");
      await navigate({ to: "/projects/$projectId/exports", params: { projectId: r.project.id } });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".zip,.json,application/zip,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f);
        }}
      />
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Spinner /> : <Upload className="size-4" />} 导入项目
      </button>
    </>
  );
}

function ProjectCard({ p, filter }: { p: ProjectListItem; filter: Filter }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const [confirm, setConfirm] = useState<null | "trash" | "delete">(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["projects"] });
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      await refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
      setMenu(false);
      setConfirm(null);
    }
  };
  const open = () => navigate({ to: "/projects/$projectId", params: { projectId: p.id } });
  const { data: me } = useMe();
  const shared = p.role !== "owner";
  return (
    <div className="card group relative">
      <button
        type="button"
        className="block w-full overflow-hidden rounded-t-xl text-left"
        onClick={open}
        disabled={filter === "trash"}
        aria-label={`打开 ${p.title}`}
      >
        {/* Covers are portrait, so a landscape crop cut most of one away. 3:4 shows the whole cover. */}
        <AssetImage assetId={p.thumbnailAssetId} alt={`${p.title} 的缩略图`} className="aspect-[3/4] w-full" />
      </button>
      <div className="p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-medium" title={p.title}>
              {p.title}
            </h3>
            <div className="muted text-xs capitalize">
              {projectTypeLabel(p.projectType)} · 更新于 {fmt.ago(p.updatedAt)}
            </div>
            {shared && (
              <div className="muted mt-1 flex items-center gap-1 text-xs" title={`由 @${p.ownerUsername} 分享给你`}>
                <span className="chip bg-accent-600/15 text-[var(--text)]">
                  <Users className="size-3" /> 已共享
                </span>
                <span className="truncate">
                  @{p.ownerUsername} · {p.role === "editor" ? "编辑者" : p.role === "viewer" ? "查看者" : "管理员"}
                </span>
              </div>
            )}
          </div>
          <StatusChip
            status={p.deletedAt ? "cancelled" : p.status}
            label={p.deletedAt ? "回收站" : p.status === "active" ? "使用中" : "已归档"}
          />
          <div>
            <button
              ref={menuAnchor}
              type="button"
              className="btn-ghost p-1"
              aria-label="项目操作"
              onClick={() => setMenu((m) => !m)}
              disabled={busy}
            >
              {busy ? <Spinner /> : <MoreVertical className="size-4" />}
            </button>
            <Popover anchor={menuAnchor} open={menu} onClose={() => setMenu(false)} className="w-44 p-1">
              <div onMouseLeave={() => setMenu(false)}>
                {filter !== "trash" && (
                  <>
                    <button type="button" className="btn-ghost w-full justify-start" onClick={open}>
                      <FolderOpen className="size-4" /> 打开
                    </button>
                    {p.role !== "viewer" && (
                      <button
                        type="button"
                        className="btn-ghost w-full justify-start"
                        onClick={() => run(() => post(`/projects/${p.id}/duplicate`), "已复制项目")}
                      >
                        <Copy className="size-4" /> 复制
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost w-full justify-start"
                      onClick={() => navigate({ to: "/projects/$projectId/exports", params: { projectId: p.id } })}
                    >
                      <Download className="size-4" /> 导出
                    </button>
                    {shared ? (
                      <button
                        type="button"
                        className="btn-ghost w-full justify-start text-red-500"
                        disabled={!me}
                        onClick={() => run(() => del(`/projects/${p.id}/members/${me?.id}`), "你已退出项目")}
                      >
                        <LogOut className="size-4" /> 退出项目
                      </button>
                    ) : p.status === "active" ? (
                      <button
                        type="button"
                        className="btn-ghost w-full justify-start"
                        onClick={() => run(() => post(`/projects/${p.id}/status`, { action: "archive" }), "已归档")}
                      >
                        <Archive className="size-4" /> 归档
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-ghost w-full justify-start"
                        onClick={() => run(() => post(`/projects/${p.id}/status`, { action: "unarchive" }), "已恢复")}
                      >
                        <ArchiveRestore className="size-4" /> 取消归档
                      </button>
                    )}
                    {!shared && (
                      <button
                        type="button"
                        className="btn-ghost w-full justify-start text-red-500"
                        onClick={() => setConfirm("trash")}
                      >
                        <Trash2 className="size-4" /> 移到回收站
                      </button>
                    )}
                  </>
                )}
                {filter === "trash" && !shared && (
                  <>
                    <button
                      type="button"
                      className="btn-ghost w-full justify-start"
                      onClick={() =>
                        run(() => post(`/projects/${p.id}/status`, { action: "restore" }), "已从回收站恢复")
                      }
                    >
                      <RotateCcw className="size-4" /> 恢复
                    </button>
                    <button
                      type="button"
                      className="btn-ghost w-full justify-start text-red-500"
                      onClick={() => setConfirm("delete")}
                    >
                      <Trash2 className="size-4" /> 永久删除
                    </button>
                  </>
                )}
              </div>
            </Popover>
          </div>
        </div>
        <dl className="muted mt-2 grid grid-cols-4 gap-1 text-center text-[11px]">
          <div>
            <dt>章节</dt>
            <dd className="text-sm text-[var(--text)]">{p.stats.chapters}</dd>
          </div>
          <div>
            <dt>画格</dt>
            <dd className="text-sm text-[var(--text)]">{p.stats.panels}</dd>
          </div>
          <div>
            <dt>生成</dt>
            <dd className="text-sm text-[var(--text)]">{p.stats.generations}</dd>
          </div>
          <div>
            <dt>费用</dt>
            <dd className="text-sm text-[var(--text)]">{fmt.usd(p.stats.estimatedSpendUsd)}</dd>
          </div>
        </dl>
      </div>
      <ConfirmDialog
        open={confirm === "trash"}
        title="移到回收站？"
        danger
        confirmLabel="移到回收站"
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => run(() => post(`/projects/${p.id}/status`, { action: "trash" }), "已移到回收站")}
      >
        “{p.title}”将移到回收站，之后可以恢复。
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "delete"}
        title="永久删除项目？"
        danger
        confirmLabel="永久删除"
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => run(() => del(`/projects/${p.id}`), "项目已删除")}
      >
        将永久删除“{p.title}”及其全部结构化数据和生成文件。此操作无法撤销。
      </ConfirmDialog>
    </div>
  );
}
