import { captionsSupported } from "@openmanga/domain/browser";
import type { RepurposeItem } from "@openmanga/schemas";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Film, PenLine, Save, Share2, Trash2, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { assetUrl, get, patch, post } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import { clsx, EmptyState, ErrorBox, Field, NumberInput, PageHeader, Spinner } from "../../components/ui.tsx";
import { statusLabel } from "../../lib/locale.ts";
import { AiChip, useAiBody } from "../ai/AiPicker.tsx";
import { useProject, useProjectId } from "../project/ProjectLayout.tsx";
import { PreviewVideoButton } from "../video/VideoPreview.tsx";
import { CaptionsField } from "./ShortsPicker.tsx";

type Candidate = {
  id: string;
  label: string;
  shotType: string;
  artAssetId: string | null;
  hasArt: boolean;
  text: string;
  holdMs: number;
  quotes: string[];
};
type Plan = { items: RepurposeItem[]; suggestion: RepurposeItem[]; candidates: Candidate[] };
type Job = { job: { status: string; failureReason?: string | null } };

const VIDEO = new Set(["short", "trailer", "teaser"]);
const KIND_LABEL: Record<RepurposeItem["kind"], string> = {
  short: "短视频",
  trailer: "预告片",
  teaser: "先导片",
  carousel: "轮播图片",
  quote: "金句图片",
};
const secs = (ms: number) => `${Math.round(ms / 1000)} s`;

/** The export request that renders one item: a Shorts cut for the video kinds, images for the others. */
function exportBody(it: RepurposeItem, language: string) {
  const social = { title: it.title, caption: it.caption };
  // An export's label is at most 60 characters; a plan may hold a longer name saved before the field said so.
  const label = (it.label.trim() || it.kind).slice(0, 60);
  if (VIDEO.has(it.kind))
    return {
      kind: "video_shorts",
      panelIds: it.panelIds,
      label,
      social,
      video: {
        shortsSeconds: it.lengthSeconds ?? 60,
        aspect: it.aspect ?? "9:16",
        captions: captionsSupported(language) ? (it.captions ?? "off") : "off",
        ...(it.hook?.trim() ? { hook: it.hook.trim() } : {}),
      },
    };
  return {
    kind: it.kind === "carousel" ? "carousel" : "quote_image",
    panelIds: it.kind === "quote" ? it.panelIds.slice(0, 1) : it.panelIds,
    label,
    social,
    still: { aspect: it.aspect === "1:1" ? "1:1" : "4:5", text: it.text },
    // A carousel is checked against Instagram's limits (slides, size) once it is made.
    ...(it.kind === "carousel" ? { target: "instagram_carousel" } : {}),
  };
}

/**
 * Repurposing a finished project: several Shorts, a trailer, a teaser, a carousel and quote images, suggested from the
 * story and adjusted here before anything is rendered. Each item renders as an export of its own.
 */
export function RepurposePage() {
  const projectId = useProjectId();
  const language = useProject().data?.project.language ?? "en";
  const [shorts, setShorts] = useState(3);
  const plan = useQuery({
    queryKey: ["repurpose", projectId, shorts],
    queryFn: () => get<Plan>(`/projects/${projectId}/repurpose?shorts=${shorts}`),
  });
  const [items, setItems] = useState<RepurposeItem[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const aiText = useAiBody("text");
  // The saved plan when there is one, else the suggestion; a refetch after saving or writing copy reloads it.
  useEffect(() => {
    if (plan.data && !dirty) setItems(plan.data.items.length ? plan.data.items : plan.data.suggestion);
  }, [plan.data]);
  const edit = (next: RepurposeItem[]) => {
    setItems(next);
    setDirty(true);
  };
  const save = useAction(
    async (list: RepurposeItem[]) => {
      await patch(`/projects/${projectId}`, { settings: { repurpose: { items: list } } });
      setDirty(false);
    },
    { invalidate: [["repurpose", projectId], qk.project(projectId)], success: "方案已保存" },
  );
  const copy = useAction(
    async () => {
      // The job writes into the saved plan, so what is on screen is saved first.
      if (items) await save.mutateAsync(items);
      return post<{ job: { id: string } }>(`/projects/${projectId}/repurpose/copy`, { ...aiText() });
    },
    { success: "正在撰写标题与发布文案…", onSuccess: (r) => setJobId(r.job.id) },
  );
  const job = useQuery({
    queryKey: ["social-copy", jobId],
    queryFn: () => get<Job>(`/generations/${jobId}`),
    enabled: Boolean(jobId),
    refetchInterval: (q) =>
      ["completed", "failed", "cancelled"].includes(q.state.data?.job.status ?? "") ? false : 2000,
  });
  const jobStatus = job.data?.job.status;
  useEffect(() => {
    if (jobStatus === "completed") {
      setJobId(null);
      setDirty(false);
      plan.refetch();
    }
  }, [jobStatus]);
  const render = useAction(
    (list: RepurposeItem[]) =>
      Promise.all(list.map((it) => post(`/projects/${projectId}/exports`, exportBody(it, language)))),
    {
      invalidate: [qk.exports(projectId)],
      success: (r) => `${r.length} 个导出已加入队列，可前往导出页下载`,
    },
  );
  const cands = plan.data?.candidates ?? [];
  const ready = (items ?? []).filter((it) => it.panelIds.length && (it.kind !== "quote" || it.text.trim()));
  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <PageHeader
        title="内容再利用"
        subtitle="从项目画格制作短视频、预告片、先导片、轮播图片与金句图片。检查所选内容后，逐项渲染导出。"
        actions={
          <>
            <label className="flex items-center gap-1 text-sm">
              <span className="muted">短视频数量</span>
              <input
                className="input w-16 py-1"
                type="number"
                min={1}
                max={10}
                value={shorts}
                onChange={(e) => setShorts(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
              />
            </label>
            <button
              type="button"
              className="btn-secondary"
              disabled={!plan.data}
              onClick={() => plan.data && edit(plan.data.suggestion)}
            >
              <Wand2 className="size-4" /> 建议方案
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!items || !dirty || save.isPending}
              onClick={() => items && save.mutate(items)}
            >
              <Save className="size-4" /> 保存方案
            </button>
          </>
        }
      />
      {plan.error && <ErrorBox error={plan.error} onRetry={() => plan.refetch()} />}
      {plan.isLoading && <Spinner />}
      {items && !items.length && (
        <EmptyState icon={<Share2 className="size-8" />} title="暂无可再利用内容">
          请先生成画格原画与旁白语音，方案将从已有原画的画格中选取内容。
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <>
          <div className="card mb-4 flex flex-wrap items-center gap-2 p-3 text-sm">
            <AiChip cap="text" />
            <button
              type="button"
              className="btn-secondary"
              disabled={copy.isPending || Boolean(jobId)}
              onClick={() => copy.mutate()}
            >
              <PenLine className="size-4" /> 撰写标题、发布文案与开场
            </button>
            {jobId && (
              <span className="muted flex items-center gap-1 text-xs">
                {jobStatus === "failed" || jobStatus === "cancelled" ? (
                  <span className="text-red-500">
                    文案任务{statusLabel(jobStatus)}， {job.data?.job.failureReason}{" "}
                    <button type="button" className="btn-ghost text-xs" onClick={() => setJobId(null)}>
                      关闭
                    </button>
                  </span>
                ) : (
                  <>
                    <Spinner /> 正在撰写…（{statusLabel(jobStatus ?? "queued")}）
                  </>
                )}
              </span>
            )}
            <button
              type="button"
              className="btn-primary ml-auto"
              disabled={!ready.length || render.isPending}
              onClick={() => render.mutate(ready)}
            >
              <Film className="size-4" /> 全部渲染（{ready.length}）
            </button>
            <Link to="/projects/$projectId/exports" params={{ projectId }} className="btn-ghost text-xs">
              导出
            </Link>
          </div>
          <ul className="space-y-3">
            {items.map((it, i) => (
              <ItemCard
                key={it.id}
                projectId={projectId}
                language={language}
                item={it}
                cands={cands}
                onChange={(next) => edit(items.map((x, j) => (j === i ? next : x)))}
                onRemove={() => edit(items.filter((_, j) => j !== i))}
                onRender={() => render.mutate([it])}
                busy={render.isPending}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ItemCard({
  projectId,
  language,
  item: it,
  cands,
  onChange,
  onRemove,
  onRender,
  busy,
}: {
  projectId: string;
  language: string;
  item: RepurposeItem;
  cands: Candidate[];
  onChange: (it: RepurposeItem) => void;
  onRemove: () => void;
  onRender: () => void;
  busy: boolean;
}) {
  const video = VIDEO.has(it.kind);
  const chosen = new Set(it.panelIds);
  const totalMs = cands.filter((c) => chosen.has(c.id)).reduce((n, c) => n + c.holdMs, 0);
  const capMs = (it.lengthSeconds ?? 60) * 1000;
  const set = (patch: Partial<RepurposeItem>) => onChange({ ...it, ...patch });
  // Story order, whatever order the boxes were ticked in.
  const toggle = (id: string) =>
    set({
      panelIds: cands
        .filter((c) => (c.id === id ? !chosen.has(id) : chosen.has(c.id)))
        .map((c) => c.id)
        .slice(0, it.kind === "quote" ? 1 : 100),
    });
  const quotePanel = cands.find((c) => c.id === it.panelIds[0]);
  // A long project has thousands of panels: the pick list is built only while it is open.
  const [picking, setPicking] = useState(false);
  return (
    <li className="card space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-xs font-medium">{KIND_LABEL[it.kind]}</span>
        <input
          className="input min-w-0 flex-1 py-1"
          aria-label="名称"
          value={it.label}
          // The export's label is at most 60 characters: a longer name saved, then failed every render.
          maxLength={60}
          onChange={(e) => set({ label: e.target.value })}
        />
        <button type="button" className="btn-ghost" aria-label="移除" title="移除" onClick={onRemove}>
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {video && (
              <Field label="时长（秒）">
                <NumberInput
                  className="input w-24"
                  min={15}
                  max={600}
                  value={it.lengthSeconds ?? 60}
                  onChange={(v) => set({ lengthSeconds: v })}
                />
              </Field>
            )}
            <Field label="画面比例">
              <select
                className="input"
                value={it.aspect ?? (video ? "9:16" : "4:5")}
                onChange={(e) => set({ aspect: e.target.value as RepurposeItem["aspect"] })}
              >
                {(video ? ["9:16", "16:9", "1:1"] : ["4:5", "1:1"]).map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </Field>
            {video && (
              <CaptionsField
                value={it.captions ?? "off"}
                onChange={(captions) => set({ captions })}
                language={language}
              />
            )}
          </div>
          {it.kind === "quote" && (
            <Field label="金句">
              <textarea
                className="input min-h-16"
                maxLength={300}
                value={it.text}
                onChange={(e) => set({ text: e.target.value })}
              />
              {quotePanel && quotePanel.quotes.length > 0 && (
                <select
                  className="input mt-1 text-xs"
                  value=""
                  aria-label="使用此画格的台词"
                  onChange={(e) => e.target.value && set({ text: e.target.value.slice(0, 300) })}
                >
                  <option value="">选择此画格的台词…</option>
                  {quotePanel.quotes.map((q) => (
                    <option key={q} value={q}>
                      {q.length > 90 ? `${q.slice(0, 90)}…` : q}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {video && (
            <Field label="开场台词" hint="在首个镜头前朗读，留空则省略">
              <input
                className="input"
                maxLength={200}
                value={it.hook ?? ""}
                placeholder="如果门自己打开了，你会怎么做？"
                onChange={(e) => set({ hook: e.target.value })}
              />
            </Field>
          )}
          <Field label="标题">
            <input
              className="input"
              maxLength={150}
              value={it.title}
              onChange={(e) => set({ title: e.target.value })}
            />
          </Field>
          <Field label="发布文案">
            <textarea
              className="input min-h-20"
              maxLength={2200}
              value={it.caption}
              onChange={(e) => set({ caption: e.target.value })}
            />
          </Field>
        </div>
        <div className="min-w-0 space-y-2">
          <p
            className={clsx(
              "text-xs tabular-nums",
              video && totalMs > capMs ? "text-amber-600 dark:text-amber-400" : "muted",
            )}
          >
            {it.panelIds.length} 个画格
            {video &&
              ` · ${secs(totalMs)}${totalMs > capMs ? ` — 超过 ${secs(capMs)}，渲染将在超出时长的镜头之前停止` : ""}`}
          </p>
          <details onToggle={(e) => setPicking(e.currentTarget.open)}>
            <summary className="cursor-pointer text-xs font-medium">
              {it.kind === "quote" ? "选择画格" : "调整所选画格"}
            </summary>
            {picking && (
              <ul className="mt-1 max-h-64 divide-y divide-[var(--border)] overflow-y-auto rounded-lg border border-[var(--border)] text-xs">
                {cands
                  .filter((c) => c.hasArt)
                  .map((c) => (
                    <li key={c.id}>
                      <label className="flex cursor-pointer items-center gap-2 p-1.5 hover:bg-[var(--panel-2)]">
                        <input
                          type={it.kind === "quote" ? "radio" : "checkbox"}
                          name={`pick-${it.id}`}
                          checked={chosen.has(c.id)}
                          onChange={() => (it.kind === "quote" ? set({ panelIds: [c.id] }) : toggle(c.id))}
                        />
                        {c.artAssetId && (
                          <img
                            src={assetUrl(c.artAssetId, "thumbnail")}
                            alt=""
                            loading="lazy"
                            className="size-10 shrink-0 rounded object-cover"
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{c.label}</span>
                          <span className="muted block truncate">{c.text || "— 无旁白 —"}</span>
                        </span>
                        {video && <span className="muted shrink-0 tabular-nums">{secs(c.holdMs)}</span>}
                      </label>
                    </li>
                  ))}
              </ul>
            )}
          </details>
          <div className="flex flex-wrap gap-1">
            {cands
              .filter((c) => chosen.has(c.id) && c.artAssetId)
              .slice(0, 12)
              .map((c) => (
                <img
                  key={c.id}
                  src={assetUrl(c.artAssetId!, "thumbnail")}
                  alt={c.label}
                  className="size-12 rounded object-cover"
                />
              ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {video && it.panelIds.length > 0 && (
          <PreviewVideoButton
            projectId={projectId}
            scope={{ panelIds: it.panelIds }}
            label="预览"
            title={`预览 — ${it.label || KIND_LABEL[it.kind]}`}
            defaultAspect={it.aspect === "16:9" || it.aspect === "1:1" ? it.aspect : "9:16"}
            capMs={capMs}
          />
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !it.panelIds.length || (it.kind === "quote" && !it.text.trim())}
          onClick={onRender}
        >
          <Film className="size-4" /> 渲染
        </button>
      </div>
    </li>
  );
}
