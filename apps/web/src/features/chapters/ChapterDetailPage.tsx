import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { get, patch, post } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import type { CastCard, ChapterDetail, ChapterListItem, ChapterRow, LocationCard } from "../../api/types.ts";
import {
  ErrorBox,
  PageHeader,
  SaveIndicator,
  Spinner,
  StatusChip,
  TagInput,
  useAutosave,
} from "../../components/ui.tsx";
import { VERSION_ACTIONS } from "../cast/fields.tsx";
import { ActiveBatches } from "../generation/BatchStatus.tsx";
import { CheckPanelsButton } from "../generation/CheckPanels.tsx";
import { BulkGenerateButton } from "../pages/BulkGenerate.tsx";
import { useProject, useProjectId } from "../project/ProjectLayout.tsx";
import { PreviewVideoButton } from "../video/VideoPreview.tsx";
import { AnimateShots } from "./AnimateShots.tsx";
import { DeleteChapterButton } from "./DeleteChapterButton.tsx";
import { PlanButton } from "./PlanButton.tsx";
import { SceneEditor } from "./SceneEditor.tsx";
import { SourceTrace } from "./SourceTrace.tsx";
import { TranslatedLettering } from "./TranslatedLettering.tsx";

export function ChapterDetailPage() {
  const projectId = useProjectId();
  const { chapterId } = useParams({ strict: false }) as { chapterId: string };
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: qk.chapter(chapterId),
    queryFn: () => get<ChapterDetail>(`/chapters/${chapterId}`),
  });
  // For the previous / next chapter links: the same list the chapters page shows, usually already cached.
  const siblings = useQuery({
    queryKey: qk.chapters(projectId),
    queryFn: () => get<{ chapters: ChapterListItem[] }>(`/projects/${projectId}/chapters`),
  });
  const locations = useQuery({
    queryKey: qk.locations(projectId),
    queryFn: () => get<{ locations: LocationCard[] }>(`/projects/${projectId}/locations`),
  });
  const cast = useQuery({
    queryKey: qk.cast(projectId),
    queryFn: () => get<{ characters: CastCard[] }>(`/projects/${projectId}/characters`),
  });
  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: qk.chapter(chapterId) });
    qc.invalidateQueries({ queryKey: qk.chapters(projectId) });
  }, [qc, chapterId, projectId]);
  const addScene = useAction(() => post(`/chapters/${chapterId}/scenes`, { title: "新建场景" }), {
    onSuccess: refresh,
  });
  const setPlanStatus = useAction((planStatus: string) => patch(`/chapters/${chapterId}`, { planStatus }), {
    onSuccess: refresh,
  });
  const project = useProject().data?.project;
  const projectLayouts = project?.settings.layouts?.length;
  const applyLayouts = useAction(
    () => post<{ changed: number; skipped: number }>(`/chapters/${chapterId}/apply-layouts`, {}),
    {
      success: (r) => `${r.changed} page(s) re-laid; ${r.skipped} kept (no layout with their number of panels)`,
      onSuccess: refresh,
    },
  );

  if (isLoading)
    return (
      <div className="p-6">
        <Spinner className="size-6" />
      </div>
    );
  if (error || !data)
    return (
      <div className="p-6">
        <ErrorBox error={error} onRetry={() => refetch()} />
      </div>
    );
  const ch = data.chapter;
  const ordered = [...(siblings.data?.chapters ?? [])].sort((a, b) => a.order - b.order);
  const at = ordered.findIndex((c) => c.id === ch.id);
  const [prev, next] = at < 0 ? [undefined, undefined] : [ordered[at - 1], ordered[at + 1]];

  return (
    <div className="space-y-5 p-6">
      <nav className="flex flex-wrap items-center gap-2 text-xs" aria-label="章节">
        <Link to="/projects/$projectId/chapters" params={{ projectId }} className="muted mr-auto hover:underline">
          ← 章节
        </Link>
        {prev && (
          <Link
            to="/projects/$projectId/chapters/$chapterId"
            params={{ projectId, chapterId: prev.id }}
            className="btn-secondary max-w-full px-2 py-1 text-xs"
            title={`第 ${prev.order} 章：${prev.title}`}
          >
            <ChevronLeft className="size-3.5 shrink-0" />
            <span className="max-w-48 truncate">
              章节 {prev.order}: {prev.title}
            </span>
          </Link>
        )}
        {next && (
          <Link
            to="/projects/$projectId/chapters/$chapterId"
            params={{ projectId, chapterId: next.id }}
            className="btn-secondary max-w-full px-2 py-1 text-xs"
            title={`第 ${next.order} 章：${next.title}`}
          >
            <span className="max-w-48 truncate">
              章节 {next.order}: {next.title}
            </span>
            <ChevronRight className="size-3.5 shrink-0" />
          </Link>
        )}
      </nav>
      <PageHeader
        title={`第 ${ch.order} 章：${ch.title}`}
        subtitle={
          <span className="inline-flex items-center gap-2">
            规划 <StatusChip status={ch.planStatus} />
          </span>
        }
        actions={
          <>
            {VERSION_ACTIONS[ch.planStatus]
              ?.filter((a) => a.status !== "superseded")
              .map((a) => (
                <button
                  key={a.status}
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPlanStatus.mutate(a.status)}
                >
                  {a.label}规划
                </button>
              ))}
            {data.pages.length > 0 && (
              <PreviewVideoButton
                projectId={projectId}
                scope={{ chapterId }}
                title={`预览 · 第 ${ch.order} 章：${ch.title}`}
              />
            )}
            <Link
              to="/projects/$projectId/narration"
              params={{ projectId }}
              search={{ chapterId }}
              className="btn-secondary"
            >
              旁白
            </Link>
            {/* Each model chip sits in one group with the AI action it chooses the model for. */}
            <span className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg bg-[var(--panel-2)] p-0.5">
              <PlanButton
                projectId={projectId}
                chapterId={chapterId}
                hasPages={data.pages.length > 0}
                label={data.pages.length ? "重新规划" : "规划章节"}
              />
            </span>
            {data.pages.length > 0 && (
              <span className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg bg-[var(--panel-2)] p-0.5">
                <BulkGenerateButton
                  projectId={projectId}
                  scope={{ chapterId }}
                  label="生成所有缺失画格"
                  className="btn-secondary"
                />
              </span>
            )}
            {data.pages.length > 0 && (projectLayouts ?? 0) > 0 && (
              <button
                type="button"
                className="btn-secondary"
                disabled={applyLayouts.isPending}
                title="使用项目布局重新排版本章页面（设置 → 页面布局）"
                onClick={() => applyLayouts.mutate()}
              >
                应用布局
              </button>
            )}
            {data.pages.length > 0 && (
              <span className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg bg-[var(--panel-2)] p-0.5">
                <CheckPanelsButton projectId={projectId} scope={{ chapterId }} />
              </span>
            )}
            <DeleteChapterButton
              projectId={projectId}
              chapter={ch}
              stats={{
                pages: data.pages.length,
                panels: data.pages.reduce((n, p) => n + p.panelCount, 0),
              }}
              onDeleted={() => navigate({ to: "/projects/$projectId/chapters", params: { projectId } })}
            />
          </>
        }
      />
      <ActiveBatches projectId={projectId} chapterId={chapterId} />

      <ChapterEditor key={ch.id} chapter={ch} onSaved={refresh} />

      <section className="card p-4">
        <div className="mb-3 flex items-center">
          <h2 className="mr-auto font-semibold">场景</h2>
          <button type="button" className="btn-secondary" onClick={() => addScene.mutate()}>
            <Plus className="size-4" /> 添加场景
          </button>
        </div>
        <div className="space-y-2">
          {data.scenes.map((s) => (
            <SceneEditor
              projectId={projectId}
              key={`${s.id}-${s.updatedAt}`}
              scene={s}
              locations={(locations.data?.locations ?? []).map((l) => ({ id: l.id, name: l.name }))}
              cast={(cast.data?.characters ?? []).map((c) => ({ id: c.id, name: c.name }))}
              onChanged={refresh}
            />
          ))}
          {!data.scenes.length && <p className="muted text-sm">暂无场景，请规划章节或手动添加场景。</p>}
        </div>
      </section>

      {data.pages.length > 0 && <SourceTrace key={chapterId} projectId={projectId} chapterId={chapterId} />}

      {data.pages.length > 0 && <AnimateShots key={`animate-${chapterId}`} chapterId={chapterId} />}

      {data.pages.length > 0 && (
        <TranslatedLettering
          key={`lettering-${chapterId}`}
          chapterId={chapterId}
          projectLanguage={project?.language ?? "en"}
          firstPageId={data.pages[0]?.id ?? null}
        />
      )}

      <section className="card p-4">
        <h2 className="mb-3 font-semibold">页面</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {data.pages.map((pg) => (
            <Link
              key={pg.id}
              to="/projects/$projectId/pages/$pageId"
              params={{ projectId, pageId: pg.id }}
              search={{}}
              className="rounded-lg border border-[var(--border)] p-3 text-sm hover:bg-[var(--panel-2)]"
            >
              <div className="font-medium">页面 {pg.order}</div>
              <div className="muted text-xs">
                {pg.readyCount}/{pg.panelCount} 个画格已就绪
              </div>
              <div className="muted truncate text-xs">{pg.layoutTemplate ?? "自定义布局"}</div>
              <div className="mt-1">
                <StatusChip status={pg.status} />
              </div>
            </Link>
          ))}
        </div>
        {!data.pages.length && <p className="muted text-sm">暂无页面。</p>}
      </section>
    </div>
  );
}

type MemoryFields = Pick<
  ChapterRow,
  | "title"
  | "summary"
  | "sourceExcerpt"
  | "openingState"
  | "closingState"
  | "characterStateChanges"
  | "locationStateChanges"
  | "revealedFacts"
>;

function ChapterEditor({ chapter, onSaved }: { chapter: ChapterRow; onSaved: () => void }) {
  const [f, setF] = useState<MemoryFields>({
    title: chapter.title,
    summary: chapter.summary,
    sourceExcerpt: chapter.sourceExcerpt,
    openingState: chapter.openingState,
    closingState: chapter.closingState,
    characterStateChanges: chapter.characterStateChanges,
    locationStateChanges: chapter.locationStateChanges,
    revealedFacts: chapter.revealedFacts,
  });
  const { state } = useAutosave(f, async (v) => {
    await patch(`/chapters/${chapter.id}`, { ...v, title: v.title.trim() || chapter.title });
    onSaved();
  });
  const list = (k: "characterStateChanges" | "locationStateChanges" | "revealedFacts", label: string) => (
    <div>
      <span className="label">{label}</span>
      <TagInput value={f[k]} onChange={(v) => setF({ ...f, [k]: v })} />
    </div>
  );
  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center">
        <h2 className="mr-auto font-semibold">章节与记忆</h2>
        <SaveIndicator state={state} />
      </div>
      <label className="block">
        <span className="label">标题</span>
        <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </label>
      <label className="block">
        <span className="label">摘要</span>
        <textarea
          className="input min-h-16"
          value={f.summary}
          onChange={(e) => setF({ ...f, summary: e.target.value })}
        />
      </label>
      <label className="block">
        <span className="label">原文片段（规划输入）</span>
        <textarea
          className="input min-h-40 font-mono text-xs"
          value={f.sourceExcerpt}
          onChange={(e) => setF({ ...f, sourceExcerpt: e.target.value })}
        />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="label">开场状态</span>
          <textarea
            className="input min-h-16"
            value={f.openingState}
            onChange={(e) => setF({ ...f, openingState: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="label">结束状态</span>
          <textarea
            className="input min-h-16"
            value={f.closingState}
            onChange={(e) => setF({ ...f, closingState: e.target.value })}
          />
        </label>
        {list("characterStateChanges", "角色状态变化")}
        {list("locationStateChanges", "地点状态变化")}
        <div className="md:col-span-2">{list("revealedFacts", "已揭示的重要事实")}</div>
      </div>
    </section>
  );
}
