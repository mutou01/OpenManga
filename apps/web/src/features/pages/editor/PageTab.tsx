import type { CustomLayout } from "@openmanga/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Download, Lock, X } from "lucide-react";
import { useEffect, useState } from "react";
import { del, get, patch, post } from "../../../api/client.ts";
import { qk, useAction, useMeta } from "../../../api/hooks.ts";
import type { PageDocument } from "../../../api/types.ts";
import { ConfirmDialog, clsx, Field, StatusChip } from "../../../components/ui.tsx";
import { ActiveBatches } from "../../generation/BatchStatus.tsx";
import { useProject, useProjectId } from "../../project/ProjectLayout.tsx";
import { PreviewVideoButton } from "../../video/VideoPreview.tsx";
import { BulkGenerateButton, LayoutThumb } from "../BulkGenerate.tsx";
import { EdgePicker } from "../EdgePicker.tsx";
import { useEditor } from "./store.ts";

export function PageTab({ data }: { data: PageDocument }) {
  const projectId = useProjectId();
  const { data: meta } = useMeta();
  const film = useProject().data?.project.settings.format === "film";
  const p = data.page;
  const [form, setForm] = useState({
    purpose: p.purpose,
    pacing: p.pacing,
    visualEmphasis: p.visualEmphasis,
    pageTurnHook: p.pageTurnHook,
  });
  const [swap, setSwap] = useState<string | null>(null);
  // The panels' border when they all share one (or all follow the project's): shown as the page-wide choice.
  const panelEdge = useEditor((s) => {
    const edges = s.doc.panels.map((pn) => pn.frame.edge);
    const first = edges[0];
    return first && edges.every((e) => e?.style === first.style && e.size === first.size) ? first : undefined;
  });
  const [layoutName, setLayoutName] = useState("");
  const qc = useQueryClient();
  const library = useQuery({ queryKey: ["layouts"], queryFn: () => get<{ layouts: CustomLayout[] }>("/layouts") });
  const projectLayouts = useProject().data?.project.settings.layouts ?? [];
  // The project's copies first, then the rest of the user's library.
  const saved = [
    ...projectLayouts,
    ...(library.data?.layouts ?? []).filter((l) => !projectLayouts.some((x) => x.id === l.id)),
  ];
  const layoutKey = p.layoutTemplate;
  const currentLayoutName = layoutKey?.startsWith("custom:")
    ? (saved.find((layout) => `custom:${layout.id}` === layoutKey)?.name ?? "已保存布局")
    : meta?.layouts.find((layout) => layout.key === layoutKey)?.name;
  const saveLayout = useAction((name: string) => post("/layouts", { name, pageId: p.id }), {
    success: "已保存到布局库",
    onSuccess: () => {
      setLayoutName("");
      void qc.invalidateQueries({ queryKey: ["layouts"] });
    },
  });
  const [removing, setRemoving] = useState<CustomLayout | null>(null);
  // Gone from the library and from this project; pages already laid out with it keep their panels.
  const removeLayout = useAction(
    async (l: CustomLayout) => {
      if (library.data?.layouts.some((x) => x.id === l.id)) await del(`/layouts/${l.id}`);
      if (projectLayouts.some((x) => x.id === l.id))
        await patch(`/projects/${projectId}`, {
          settings: { layouts: projectLayouts.filter((x) => x.id !== l.id) },
        });
    },
    {
      success: "已删除布局",
      onSuccess: () => {
        setRemoving(null);
        void qc.invalidateQueries({ queryKey: ["layouts"] });
        void qc.invalidateQueries({ queryKey: qk.project(projectId) });
      },
    },
  );
  useEffect(
    () =>
      setForm({ purpose: p.purpose, pacing: p.pacing, visualEmphasis: p.visualEmphasis, pageTurnHook: p.pageTurnHook }),
    [p.id, p.updatedAt],
  );
  const inv = [qk.page(p.id), qk.chapter(p.chapterId)];
  const save = useAction((body: Record<string, unknown>) => patch(`/pages/${p.id}`, body), {
    invalidate: inv,
    success: "已保存页面",
  });
  const layout = useAction((layoutTemplate: string) => post(`/pages/${p.id}/layout`, { layoutTemplate }), {
    invalidate: inv,
    success: "已应用布局",
    onSuccess: () => setSwap(null),
  });
  const exportPng = useAction(() => post(`/projects/${projectId}/exports`, { kind: "png_pages", pageIds: [p.id] }), {
    invalidate: [qk.exports(projectId)],
    success: "PNG 导出已加入队列，请到导出页面查看",
  });
  const idx = data.siblings.findIndex((s) => s.id === p.id);
  const prev = data.siblings[idx - 1];
  const next = data.siblings[idx + 1];
  const locked = p.status === "locked";

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between">
        {prev ? (
          <Link
            to="/projects/$projectId/pages/$pageId"
            params={{ projectId, pageId: prev.id }}
            search={{}}
            className="btn-ghost"
          >
            <ChevronLeft className="size-4" /> 页面 {prev.order}
          </Link>
        ) : (
          <span />
        )}
        <span className="muted text-xs">
          页面 {p.order} / {data.siblings.length}
        </span>
        {next ? (
          <Link
            to="/projects/$projectId/pages/$pageId"
            params={{ projectId, pageId: next.id }}
            search={{}}
            className="btn-ghost"
          >
            页面 {next.order} <ChevronRight className="size-4" />
          </Link>
        ) : (
          <span />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <StatusChip status={p.status} />
        {p.status === "draft" && (
          <button type="button" className="btn-secondary py-1" onClick={() => save.mutate({ status: "approved" })}>
            审核通过页面
          </button>
        )}
        {p.status === "approved" && (
          <>
            <button type="button" className="btn-secondary py-1" onClick={() => save.mutate({ status: "draft" })}>
              撤销审核
            </button>
            <button type="button" className="btn-secondary py-1" onClick={() => save.mutate({ status: "locked" })}>
              <Lock className="size-3.5" /> 锁定
            </button>
          </>
        )}
      </div>
      <fieldset disabled={locked} className="space-y-3">
        {(["purpose", "pacing", "visualEmphasis", "pageTurnHook"] as const).map((k) => (
          <Field
            key={k}
            label={
              {
                purpose: "页面用途",
                pacing: "节奏",
                visualEmphasis: "视觉重点",
                pageTurnHook: "翻页悬念",
              }[k]
            }
          >
            <textarea
              className="input"
              rows={2}
              value={form[k]}
              onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
            />
          </Field>
        ))}
        <button
          type="button"
          className="btn-primary w-full"
          disabled={save.isPending}
          onClick={() => save.mutate(form)}
        >
          保存页面规划
        </button>
        <div hidden={film} className="space-y-2 rounded-lg border border-[var(--border)] p-2">
          <div className="label">边框</div>
          <EdgePicker
            label="本页边缘"
            inheritLabel="项目默认"
            value={p.edge ?? undefined}
            onChange={(edge) => save.mutate({ edge: edge ?? null })}
          />
          <EdgePicker
            label="本页所有分镜"
            inheritLabel="项目默认"
            value={panelEdge}
            onChange={(edge) =>
              useEditor.getState().commit((d) => ({
                ...d,
                panels: d.panels.map((pn) => {
                  const { edge: _e, ...frame } = pn.frame;
                  return { ...pn, frame: edge ? { ...frame, edge } : frame };
                }),
              }))
            }
          />
          <p className="muted text-xs">
            页面边缘仅对本页覆盖项目设置。分镜边框会同时应用到本页所有分镜，仍可在各自的“分镜”选项卡中单独调整。
          </p>
        </div>
        <div hidden={film}>
          <div className="label">
            布局模板 {layoutKey ? `（当前 ${currentLayoutName ?? layoutKey}）` : "（自定义）"}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {meta?.layouts.map((t) => (
              <button
                key={t.key}
                type="button"
                title={t.name}
                aria-label={`使用布局 ${t.name}`}
                onClick={() => setSwap(t.key)}
                className={clsx(
                  "card flex flex-col items-center p-1.5 text-[10px] hover:border-accent-500",
                  p.layoutTemplate === t.key && "border-accent-500",
                )}
              >
                <LayoutThumb frames={t.frames} className="h-10 w-7" />
              </button>
            ))}
          </div>
          {saved.length > 0 && (
            <>
              <div className="label mt-2">你的布局</div>
              <div className="grid grid-cols-4 gap-1.5">
                {saved.map((l) => (
                  <div key={l.id} className="relative">
                    <button
                      type="button"
                      title={`${l.name} · ${l.frames.length} 个分镜`}
                      aria-label={`使用布局 ${l.name}`}
                      onClick={() => setSwap(`custom:${l.id}`)}
                      className={clsx(
                        "card flex flex-col items-center gap-0.5 p-1.5 text-[10px] hover:border-accent-500",
                        p.layoutTemplate === `custom:${l.id}` && "border-accent-500",
                      )}
                    >
                      <LayoutThumb frames={l.frames} className="h-10 w-7" />
                      <span className="w-full truncate text-center">{l.name}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`删除布局 ${l.name}`}
                      title="删除布局"
                      onClick={() => setRemoving(l)}
                      className="absolute -top-1.5 -right-1.5 rounded-full border border-[var(--border)] bg-[var(--panel)] p-0.5 hover:text-red-500"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (layoutName.trim()) saveLayout.mutate(layoutName.trim());
            }}
          >
            <input
              className="input flex-1 text-xs"
              aria-label="布局名称"
              placeholder="为本页布局命名"
              maxLength={80}
              value={layoutName}
              onChange={(e) => setLayoutName(e.target.value)}
            />
            <button
              type="submit"
              className="btn-secondary text-xs"
              disabled={saveLayout.isPending || !layoutName.trim()}
            >
              保存为布局
            </button>
          </form>
          <p className="muted text-xs">
            将本页分镜（包括形状和边框）保存到布局库，供所有项目使用。在项目设置的“页面布局”中选择新页面规划要使用的布局。
          </p>
        </div>
      </fieldset>
      <div className="grid gap-2">
        <BulkGenerateButton projectId={projectId} scope={{ pageId: p.id }} label={film ? "生成镜头" : "生成页面"} />
        <ActiveBatches projectId={projectId} pageId={p.id} compact />
        <PreviewVideoButton
          projectId={projectId}
          scope={{ pageId: p.id }}
          label={film ? "预览镜头视频" : "预览页面视频"}
          title={`预览 · 第 ${p.order} 页`}
        />
        <button
          type="button"
          className="btn-secondary"
          disabled={exportPng.isPending}
          onClick={() => exportPng.mutate()}
        >
          <Download className="size-4" /> 导出页面 PNG
        </button>
      </div>
      <ConfirmDialog
        open={Boolean(swap)}
        title="更换布局模板？"
        confirmLabel="应用布局"
        busy={layout.isPending}
        onClose={() => setSwap(null)}
        onConfirm={() => swap && layout.mutate(swap)}
      >
        已有分镜将按阅读顺序移入新画框，并保留图片和对白排版。多出的画框会创建为空分镜。
      </ConfirmDialog>
      <ConfirmDialog
        open={Boolean(removing)}
        title={`删除布局“${removing?.name ?? ""}”？`}
        confirmLabel="删除"
        danger
        busy={removeLayout.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && removeLayout.mutate(removing)}
      >
        将从布局库和当前项目中移除此布局。已有页面保留其分镜，其他项目保留各自的布局副本。
      </ConfirmDialog>
    </div>
  );
}
