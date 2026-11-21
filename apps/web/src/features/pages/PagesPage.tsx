import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, BookOpen, LayoutGrid, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { assetUrl, del, get, patch, post } from "../../api/client.ts";
import { qk, useAction, useMeta } from "../../api/hooks.ts";
import type { ChapterDetail, ChapterDetailPage, ChapterListItem } from "../../api/types.ts";
import {
  ConfirmDialog,
  clsx,
  EmptyState,
  ErrorBox,
  Modal,
  PageHeader,
  Spinner,
  StatusChip,
} from "../../components/ui.tsx";
import { CommentBadge, useCommentCounts } from "../comments/comments.tsx";
import { ActiveBatches } from "../generation/BatchStatus.tsx";
import { useProject, useProjectId } from "../project/ProjectLayout.tsx";
import { PreviewVideoButton } from "../video/VideoPreview.tsx";
import { BulkGenerateButton, LayoutThumb } from "./BulkGenerate.tsx";

/**
 * Draws from the chapter payload rather than fetching. One query per card meant a request per page on every
 * visit — 148 of them for a feature-length film project, which rate-limited the grid on its own.
 */
function PagePreview({ page }: { page: ChapterDetailPage }) {
  const { width: W, height: H } = page;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full bg-white" role="img" aria-label={`第 ${page.order} 页预览`}>
      {page.panels.map((p) => {
        const x = p.frame.x * W;
        const y = p.frame.y * H;
        const w = p.frame.width * W;
        const h = p.frame.height * H;
        return (
          <g key={p.id}>
            <rect x={x} y={y} width={w} height={h} fill="#e5e7eb" />
            {p.activeArtworkAssetId && (
              <image
                href={assetUrl(p.activeArtworkAssetId, "thumbnail")}
                x={x}
                y={y}
                width={w}
                height={h}
                preserveAspectRatio="xMidYMid slice"
              />
            )}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill="none"
              stroke={
                p.status === "failed"
                  ? "#ef4444"
                  : p.review
                    ? "#8b5cf6"
                    : (p.qa as { verdict?: string; stale?: boolean } | null)?.verdict === "mismatch" &&
                        !(p.qa as { stale?: boolean }).stale
                      ? "#f59e0b"
                      : "#111"
              }
              strokeWidth={W / 200}
              strokeDasharray={
                (p.qa as { verdict?: string } | null)?.verdict === "mismatch" ? `${W / 60} ${W / 120}` : undefined
              }
            />
          </g>
        );
      })}
    </svg>
  );
}

export function PagesPage() {
  const projectId = useProjectId();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { chapterId?: string };
  const commentCounts = useCommentCounts(projectId).data;
  const chapters = useQuery({
    queryKey: qk.chapters(projectId),
    // Cache holds the raw response shape shared with other screens; select derives the list.
    queryFn: () => get<{ chapters: ChapterListItem[] }>(`/projects/${projectId}/chapters`),
    select: (r) => r.chapters,
  });
  const chapterId = search.chapterId ?? chapters.data?.[0]?.id;
  const chapter = useQuery({
    queryKey: qk.chapter(chapterId ?? ""),
    queryFn: () => get<ChapterDetail>(`/chapters/${chapterId}`),
    enabled: Boolean(chapterId),
  });
  const { data: meta } = useMeta();
  const isStrip = useProject().data?.project.settings.format === "vertical";
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const inv = [qk.chapter(chapterId ?? ""), qk.chapters(projectId)];

  const addPage = useAction(
    (layoutTemplate: string) => post<{ page: { id: string } }>(`/chapters/${chapterId}/pages`, { layoutTemplate }),
    { invalidate: inv, success: "已添加页面", onSuccess: () => setAdding(false) },
  );
  const move = useAction((v: { id: string; order: number }) => patch(`/pages/${v.id}`, { order: v.order }), {
    invalidate: inv,
  });
  const remove = useAction((id: string) => del(`/pages/${id}`), {
    invalidate: inv,
    success: "已删除页面",
    onSuccess: () => setDeleting(null),
  });

  if (chapters.isLoading)
    return (
      <div className="p-6">
        <Spinner />
      </div>
    );
  if (chapters.error)
    return (
      <div className="p-6">
        <ErrorBox error={chapters.error} onRetry={() => chapters.refetch()} />
      </div>
    );
  if (!chapters.data?.length)
    return (
      <div className="p-6">
        <EmptyState
          icon={<LayoutGrid className="size-8" />}
          title="暂无章节"
          action={
            <Link to="/projects/$projectId/chapters" params={{ projectId }} className="btn-primary">
              前往章节
            </Link>
          }
        >
          先分析故事或创建章节，再规划页面。
        </EmptyState>
      </div>
    );

  const pages = chapter.data?.pages ?? [];
  const totalPanels = pages.reduce((s, p) => s + p.panelCount, 0);
  const ready = pages.reduce((s, p) => s + p.readyCount, 0);

  return (
    <div className="p-6">
      <PageHeader
        title="页面"
        subtitle={chapter.data ? `${pages.length} 页 · ${ready} / ${totalPanels} 个分镜已有图片` : undefined}
        actions={
          <>
            <label className="sr-only" htmlFor="chapter-select">
              章节
            </label>
            <select
              id="chapter-select"
              className="input w-56"
              value={chapterId}
              onChange={(e) =>
                navigate({
                  to: "/projects/$projectId/pages",
                  params: { projectId },
                  search: { chapterId: e.target.value },
                })
              }
            >
              {chapters.data.map((c) => (
                <option key={c.id} value={c.id}>
                  第 {c.order} — {c.title}
                </option>
              ))}
            </select>
            {chapterId && pages.length > 0 && (
              <PreviewVideoButton
                projectId={projectId}
                scope={{ chapterId }}
                label="播放章节"
                title={(() => {
                  const c = chapters.data.find((x) => x.id === chapterId);
                  return c ? `预览 · 第 ${c.order} 章 ${c.title}` : "预览";
                })()}
              />
            )}
            {chapterId && totalPanels > 0 && (
              <BulkGenerateButton
                projectId={projectId}
                scope={{ chapterId }}
                label="生成章节"
                className="btn-secondary"
              />
            )}
            {isStrip && chapterId && (
              <Link
                to="/projects/$projectId/read"
                params={{ projectId }}
                search={{ chapterId }}
                className="btn-secondary"
              >
                <BookOpen className="size-4" /> 阅读条漫
              </Link>
            )}
            <button type="button" className="btn-primary" onClick={() => setAdding(true)} disabled={!chapterId}>
              <Plus className="size-4" /> 添加页面
            </button>
          </>
        }
      />
      {chapterId && <ActiveBatches projectId={projectId} chapterId={chapterId} className="mb-4" />}
      {chapter.error && <ErrorBox error={chapter.error} />}
      {chapter.isLoading && <Spinner />}
      {chapter.data && !pages.length && (
        <EmptyState
          icon={<LayoutGrid className="size-8" />}
          title="本章暂无页面"
          action={
            <Link
              to="/projects/$projectId/chapters/$chapterId"
              params={{ projectId, chapterId: chapterId! }}
              className="btn-secondary"
            >
              用 AI 规划章节
            </Link>
          }
        >
          规划章节可自动创建场景、页面与分镜，也可以手动添加页面。
        </EmptyState>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {pages.map((p, i) => (
          <div key={p.id} className="card group overflow-hidden">
            <Link
              to="/projects/$projectId/pages/$pageId"
              params={{ projectId, pageId: p.id }}
              search={{}}
              aria-label={`在编辑器中打开第 ${p.order} 页`}
              className="block focus-visible:outline-2 focus-visible:outline-accent-500"
            >
              <PagePreview page={p} />
            </Link>
            <div className="flex items-center justify-between gap-1 p-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-1 font-medium">
                  页面 {p.order} <CommentBadge n={commentCounts?.pages[p.id]} />
                </div>
                <div className="muted truncate text-xs">
                  {p.readyCount}/{p.panelCount} 已就绪
                </div>
              </div>
              <StatusChip status={p.status} />
            </div>
            <div className="flex justify-end gap-0.5 border-t border-[var(--border)] p-1">
              <button
                type="button"
                className="btn-ghost p-1"
                aria-label="将页面前移"
                disabled={i === 0 || move.isPending}
                onClick={() => move.mutate({ id: p.id, order: p.order - 1 })}
              >
                <ArrowUp className="size-3.5" />
              </button>
              <button
                type="button"
                className="btn-ghost p-1"
                aria-label="将页面后移"
                disabled={i === pages.length - 1 || move.isPending}
                onClick={() => move.mutate({ id: p.id, order: p.order + 1 })}
              >
                <ArrowDown className="size-3.5" />
              </button>
              <button
                type="button"
                className="btn-ghost p-1 text-red-500"
                aria-label="删除页面"
                onClick={() => setDeleting(p.id)}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="添加页面 · 选择布局" wide>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {meta?.layouts.map((t) => (
            <button
              key={t.key}
              type="button"
              disabled={addPage.isPending}
              onClick={() => addPage.mutate(t.key)}
              className={clsx("card flex flex-col items-center gap-2 p-3 text-center text-xs hover:border-accent-500")}
            >
              <LayoutThumb frames={t.frames} className="h-24 w-16" />
              <span className="font-medium">{t.name}</span>
            </button>
          ))}
        </div>
      </Modal>
      <ConfirmDialog
        open={Boolean(deleting)}
        title="删除页面？"
        danger
        confirmLabel="删除页面"
        busy={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        将删除此页及其分镜和对白排版。已生成图片仍保留在素材库中。
      </ConfirmDialog>
    </div>
  );
}
