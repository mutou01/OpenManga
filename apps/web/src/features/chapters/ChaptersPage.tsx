import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileText, Plus } from "lucide-react";
import { useState } from "react";
import { get, post } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import type { ChapterListItem } from "../../api/types.ts";
import { EmptyState, ErrorBox, Modal, PageHeader, Spinner, StatusChip } from "../../components/ui.tsx";
import { statusLabel } from "../../lib/locale.ts";
import { ChapterBatchChip } from "../generation/BatchStatus.tsx";
import { useProjectId } from "../project/ProjectLayout.tsx";
import { DeleteChapterButton } from "./DeleteChapterButton.tsx";
import { PlanButton } from "./PlanButton.tsx";

export function NarrationCoverage({ stats: s }: { stats: NonNullable<ChapterListItem["stats"]> }) {
  if (!s.panels) return null;
  if (!s.narration) return <span className="chip bg-amber-500/15 text-amber-600 dark:text-amber-300">无旁白</span>;
  const pct = Math.round((Math.min(s.narratedPanels, s.panels) / s.panels) * 100);
  return (
    <span
      className={
        pct < 90 ? "chip bg-amber-500/15 text-amber-600 dark:text-amber-300" : "chip bg-emerald-500/15 text-emerald-600"
      }
      title="至少包含一行旁白的画格"
    >
      旁白覆盖 {pct}%
    </span>
  );
}

export function ChaptersPage() {
  const projectId = useProjectId();
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: qk.chapters(projectId),
    queryFn: () => get<{ chapters: ChapterListItem[] }>(`/projects/${projectId}/chapters`),
  });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", summary: "", sourceExcerpt: "" });
  const create = useAction(() => post(`/projects/${projectId}/chapters`, form), {
    invalidate: [qk.chapters(projectId)],
    success: "章节已创建",
    onSuccess: () => {
      setCreating(false);
      setForm({ title: "", summary: "", sourceExcerpt: "" });
    },
  });

  return (
    <div className="p-6">
      <PageHeader
        title="章节"
        subtitle="按章节、场景、页面、画格逐级规划。"
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> 新建章节
          </button>
        }
      />
      <ErrorBox error={error} onRetry={() => refetch()} />
      {isLoading && <Spinner className="size-6" />}
      {data && !data.chapters.length && (
        <EmptyState icon={<FileText className="size-8" />} title="暂无章节">
          应用故事分析以创建章节，或手动添加章节。
        </EmptyState>
      )}
      <div className="space-y-3">
        {data?.chapters.map((ch) => {
          const s = ch.stats;
          return (
            <div key={ch.id} className="card flex flex-wrap items-start gap-4 p-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--panel-2)] font-semibold">
                {ch.order}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/projects/$projectId/chapters/$chapterId"
                    params={{ projectId, chapterId: ch.id }}
                    className="font-medium hover:underline"
                  >
                    {ch.title}
                  </Link>
                  <StatusChip status={ch.planStatus} label={`规划：${statusLabel(ch.planStatus)}`} />
                  {!ch.hasPlan && <span className="muted text-xs">尚未规划</span>}
                  <ChapterBatchChip projectId={projectId} chapterId={ch.id} />
                </div>
                <p className="muted mt-1 line-clamp-2 text-sm">{ch.summary || "暂无摘要"}</p>
                {s && (
                  <div className="muted mt-2 flex flex-wrap gap-3 text-xs">
                    <span>{s.scenes} 个场景</span>
                    <span>{s.pages} 页</span>
                    <span>
                      已绘制 {s.ready}/{s.panels} 个画格
                    </span>
                    <span>{s.narration} 条旁白</span>
                    <NarrationCoverage stats={s} />
                    <span>原文 {ch.sourceLength.toLocaleString()} 字</span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <PlanButton
                  projectId={projectId}
                  chapterId={ch.id}
                  hasPages={(s?.pages ?? 0) > 0}
                  label={s?.pages ? "重新规划" : "规划章节"}
                />
                <Link
                  to="/projects/$projectId/pages"
                  params={{ projectId }}
                  search={{ chapterId: ch.id }}
                  className="btn-secondary"
                >
                  页面
                </Link>
                <Link
                  to="/projects/$projectId/narration"
                  params={{ projectId }}
                  search={{ chapterId: ch.id }}
                  className="btn-secondary"
                >
                  旁白
                </Link>
                <DeleteChapterButton projectId={projectId} chapter={ch} stats={s} />
              </div>
            </div>
          );
        })}
      </div>
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="新建章节"
        wide
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCreating(false)}>
              取消
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!form.title.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              创建
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="label">标题</span>
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">摘要</span>
            <textarea
              className="input min-h-16"
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="label">原文（用于规划）</span>
            <textarea
              className="input min-h-48"
              value={form.sourceExcerpt}
              onChange={(e) => setForm({ ...form, sourceExcerpt: e.target.value })}
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}
