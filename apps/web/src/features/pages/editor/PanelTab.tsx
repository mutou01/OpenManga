import {
  CameraAngle,
  type EdgeStyle,
  type PanelGuide,
  PanelSpec,
  ShotType,
  ShotVideo,
  type StoredPanelSpec,
} from "@openmanga/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  ImagePlus,
  Lock,
  Move,
  PencilLine,
  RefreshCw,
  ScanEye,
  Spline,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api, get, patch, post, put } from "../../../api/client.ts";
import { qk, useAction } from "../../../api/hooks.ts";
import type { EditorPanel, LocationCard, PageDocument, PropCard } from "../../../api/types.ts";
import { AssetImage, clsx, Field, Spinner, StatusChip, TagInput, toast } from "../../../components/ui.tsx";
import { useAiBody } from "../../ai/AiPicker.tsx";
import { BoardGuidePicker } from "../../board/BoardPicker.tsx";
import { CommentBadge, useCommentCounts } from "../../comments/comments.tsx";
import { useProject, useProjectId } from "../../project/ProjectLayout.tsx";
import { PreviewVideoButton } from "../../video/VideoPreview.tsx";
import { EdgePicker } from "../EdgePicker.tsx";
import { ClipPanel } from "./ClipPanel.tsx";
import { CompareModels } from "./CompareModels.tsx";
import { CoverageSheet } from "./CoverageSheet.tsx";
import { DescribePose } from "./DescribePose.tsx";
import { Directing } from "./Directing.tsx";
import { Effects } from "./Effects.tsx";
import { GuideDrawer } from "./GuideDrawer.tsx";
import { ImageTools } from "./ImageTools.tsx";
import { editorLabel } from "./labels.ts";
import { OutfitPicker, type PanelOutfits } from "./OutfitPicker.tsx";
import { useEditor } from "./store.ts";

/** Prepared prompt fields the planner prefers over the panel spec, in the order the prompt reads them. */
const DRAFT_FIELDS = ["intent", "action", "expression", "composition", "lighting", "continuity"] as const;

type PanelDetail = {
  characters: { id: string; versionNumber: number; status: string; characterId: string; name: string }[];
};

/** `onDelete` is left out for members who may not delete panels (only the owner can). */
export function PanelList({ data, onDelete }: { data: PageDocument; onDelete?: (id: string) => void }) {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const ordered = [...doc.panels].sort((a, b) => a.order - b.order);
  const counts = useCommentCounts(useProjectId()).data;
  const reorder = useAction((panelIds: string[]) => post(`/pages/${data.page.id}/reorder-panels`, { panelIds }), {
    invalidate: [qk.page(data.page.id)],
  });
  const move = (idx: number, dir: -1 | 1) => {
    const ids = ordered.map((p) => p.id);
    const [id] = ids.splice(idx, 1);
    ids.splice(idx + dir, 0, id!);
    useEditor
      .getState()
      .commit((d) => ({ ...d, panels: d.panels.map((p) => ({ ...p, order: ids.indexOf(p.id) + 1 })) }));
    reorder.mutate(ids);
  };
  return (
    <ul className="space-y-1" aria-label="按阅读顺序排列的分镜">
      {ordered.map((p, i) => {
        const server = data.panels.find((s) => s.id === p.id);
        const active = selection?.type === "panel" && selection.ids.includes(p.id);
        return (
          <li
            key={p.id}
            className={clsx(
              "flex items-center gap-1 rounded-lg border px-2 py-1 text-xs",
              active ? "border-accent-500 bg-accent-600/10" : "border-[var(--border)]",
            )}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              onClick={(e) => select({ type: "panel", ids: [p.id] }, e.shiftKey)}
            >
              <span className="font-semibold tabular-nums">{i + 1}</span>
              <span className="muted truncate">{server?.storyBeat || "未命名分镜"}</span>
            </button>
            <CommentBadge n={counts?.panels[p.id]} />
            {server && <StatusChip status={server.status} />}
            <button
              type="button"
              className="btn-ghost p-0.5"
              aria-label="将分镜前移"
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <ArrowUp className="size-3.5" />
            </button>
            <button
              type="button"
              className="btn-ghost p-0.5"
              aria-label="将分镜后移"
              disabled={i === ordered.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown className="size-3.5" />
            </button>
            {onDelete && (
              <button
                type="button"
                className="btn-ghost p-0.5 text-red-500"
                aria-label="删除分镜"
                onClick={() => onDelete(p.id)}
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const areas = ["upper-left", "upper-right", "top", "bottom", "lower-left", "lower-right", "left", "right"];

function AdjustImageButton({ panelId, disabled }: { panelId: string; disabled: boolean }) {
  const active = useEditor((s) => s.adjustImageFor === panelId);
  return (
    <button
      type="button"
      className={active ? "btn-primary flex-1 text-xs" : "btn-secondary flex-1 text-xs"}
      disabled={disabled}
      aria-pressed={active}
      onClick={() => useEditor.getState().setAdjustImage(active ? null : panelId)}
    >
      <Move className="size-3.5" /> {active ? "完成图片移动" : "移动或缩放页面中的图片"}
    </button>
  );
}

/**
 * While the image is being adjusted: a zoom slider (no wheel needed) and what dragging can do. At 100% the image
 * just covers the panel, so it moves only along the side where it overflows; zoom in to move it freely.
 */
function ImageZoom({ panelId }: { panelId: string }) {
  const active = useEditor((s) => s.adjustImageFor === panelId);
  const scale = useEditor((s) => s.doc.panels.find((p) => p.id === panelId)?.imageTransform.scale ?? 1);
  if (!active) return null;
  const setScale = (v: number) =>
    useEditor.getState().commit((d) => ({
      ...d,
      panels: d.panels.map((p) => (p.id === panelId ? { ...p, imageTransform: { ...p.imageTransform, scale: v } } : p)),
    }));
  return (
    <div className="w-full space-y-1">
      <label className="flex items-center gap-2 text-xs">
        <span className="label w-10">缩放</span>
        <input
          type="range"
          className="flex-1"
          aria-label="图片缩放"
          min={1}
          max={4}
          step={0.05}
          value={scale}
          onChange={(e) => setScale(Number(e.target.value))}
        />
        <span className="w-10 text-right tabular-nums">{Math.round(scale * 100)}%</span>
      </label>
      <p className="muted text-xs">
        在页面上拖动图片以移动。100%
        时图片刚好覆盖分镜，仅可沿溢出方向移动。在这里或用鼠标滚轮放大后可自由移动，完成后按 Enter 或 Esc。
      </p>
    </div>
  );
}

/**
 * A panel's outline: a rectangle until its points are edited. Edit shape shows a handle on every point (drag it,
 * double-click to remove) and a "+" on every edge (click to add a point there), for slanted gutters, pointed tops and
 * panels that slide into each other.
 */
function PanelShape({ panelId, disabled }: { panelId: string; disabled: boolean }) {
  const active = useEditor((s) => s.shapeEditFor === panelId);
  const shaped = useEditor((s) => Boolean(s.doc.panels.find((p) => p.id === panelId)?.frame.points));
  const edge = useEditor((s) => s.doc.panels.find((p) => p.id === panelId)?.frame.edge);
  const setEdge = (e: EdgeStyle | undefined) =>
    useEditor.getState().commit((d) => ({
      ...d,
      panels: d.panels.map((p) => {
        if (p.id !== panelId) return p;
        const { edge: _e, ...frame } = p.frame;
        return { ...p, frame: e ? { ...frame, edge: e } : frame };
      }),
    }));
  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] p-2">
      <div className="label">分镜形状与边框</div>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className={active ? "btn-primary flex-1 text-xs" : "btn-secondary flex-1 text-xs"}
          disabled={disabled}
          aria-pressed={active}
          onClick={() => useEditor.getState().setShapeEdit(active ? null : panelId)}
        >
          <Spline className="size-3.5" /> {active ? "完成形状编辑" : "编辑形状"}
        </button>
        {shaped && (
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={disabled}
            onClick={() =>
              useEditor.getState().commit((d) => ({
                ...d,
                panels: d.panels.map((p) => {
                  if (p.id !== panelId) return p;
                  const { points: _p, ...box } = p.frame;
                  return { ...p, frame: box };
                }),
              }))
            }
          >
            重置为矩形
          </button>
        )}
      </div>
      <EdgePicker label="分镜边框" inheritLabel="项目默认" value={edge} disabled={disabled} onChange={setEdge} />
      {active && (
        <p className="muted text-xs">
          拖动节点可移动，点击边缘虚线圆圈可添加节点，双击节点可移除。完成后按 Enter 或 Esc。
        </p>
      )}
    </div>
  );
}

export function PanelTab({
  data,
  panel,
  onDelete,
}: {
  data: PageDocument;
  panel: EditorPanel;
  onDelete?: (id: string) => void;
}) {
  const projectId = useProjectId();
  const locked = panel.approvalStatus === "locked";
  const [spec, setSpec] = useState<StoredPanelSpec>(
    () => panel.spec ?? PanelSpec.parse({ beat: panel.storyBeat || "New panel" }),
  );
  useEffect(
    () => setSpec(panel.spec ?? PanelSpec.parse({ beat: panel.storyBeat || "New panel" })),
    [panel.id, panel.specVersion],
  );
  const detail = useQuery({ queryKey: qk.panel(panel.id), queryFn: () => get<PanelDetail>(`/panels/${panel.id}`) });
  const locations = useQuery({
    queryKey: qk.locations(projectId),
    queryFn: () => get<{ locations: LocationCard[] }>(`/projects/${projectId}/locations`),
    select: (r) => r.locations,
  });
  const props = useQuery({
    queryKey: qk.props(projectId),
    queryFn: () => get<{ props: PropCard[] }>(`/projects/${projectId}/props`),
    select: (r) => r.props,
  });
  const inv = [qk.page(data.page.id), qk.panel(panel.id)];
  const outfits = useQuery({
    queryKey: [...qk.panel(panel.id), "outfits"],
    queryFn: () => get<PanelOutfits>(`/panels/${panel.id}/outfits`),
  });

  const saveSpec = useAction(() => put(`/panels/${panel.id}/spec`, { spec }), {
    invalidate: inv,
    success: "已保存分镜设定",
  });
  const patchPanel = useAction((body: Record<string, unknown>) => patch(`/panels/${panel.id}`, body), {
    invalidate: inv,
  });
  const duplicate = useAction(() => post(`/pages/${data.page.id}/panels`, { duplicateOf: panel.id }), {
    invalidate: [qk.page(data.page.id)],
    success: "已复制分镜",
  });
  const split = useAction((direction: "horizontal" | "vertical") => post(`/panels/${panel.id}/split`, { direction }), {
    invalidate: [qk.page(data.page.id)],
    success: "已拆分分镜",
  });

  const attached = detail.data?.characters ?? [];
  const isStrip = useProject().data?.project.settings.format === "vertical";
  const seam = panel.seam ?? undefined;
  // Prepared text outranks the spec fields in the compiled prompt (intent over the beat, action, expression,
  // composition and lighting), so an edit here looks ignored until it is discarded. Continuity merges instead.
  const draft = (panel.promptDraft ?? null) as Record<string, unknown> | null;
  const draftFields = DRAFT_FIELDS.filter((k) => {
    const v = draft?.[k];
    return Array.isArray(v) ? v.length > 0 : String(v ?? "").trim().length > 0;
  });
  const draftHasContinuity = draftFields.includes("continuity");
  const toggleCharacter = (c: PageDocument["cast"][number]) => {
    const current = attached.find((a) => a.characterId === c.id);
    const ids = current
      ? panel.characterVersionIds.filter((v) => v !== current.id)
      : c.currentVersionId
        ? [...panel.characterVersionIds, c.currentVersionId]
        : panel.characterVersionIds;
    patchPanel.mutate({ characterVersionIds: ids });
    setSpec((s) => ({
      ...s,
      characters: current
        ? s.characters.filter((x) => x.characterId !== c.id)
        : [...s.characters, { characterId: c.id, expression: "", pose: "", action: "", outfit: "", position: "" }],
    }));
  };
  const setField = <K extends keyof PanelSpec>(k: K, v: PanelSpec[K]) => setSpec((s) => ({ ...s, [k]: v }));
  const transform =
    useEditor((s) => s.doc.panels.find((p) => p.id === panel.id)?.imageTransform) ?? panel.imageTransform;
  const setTransform = (k: "focalX" | "focalY" | "scale", v: number) =>
    useEditor.getState().commit((d) => ({
      ...d,
      panels: d.panels.map((p) => (p.id === panel.id ? { ...p, imageTransform: { ...p.imageTransform, [k]: v } } : p)),
    }));

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-1">
        <StatusChip status={panel.status} />
        <StatusChip status={panel.approvalStatus} />
        <QaBadge panelId={panel.id} qa={panel.qa as Qa | null} hasArt={Boolean(panel.activeArtworkAssetId)} />
        {panel.review && <ReviewBadge panelId={panel.id} review={panel.review} invalidate={inv} />}
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            className="btn-ghost p-1.5"
            title="复制（Ctrl+D）"
            aria-label="复制分镜"
            disabled={locked}
            onClick={() => duplicate.mutate()}
          >
            <Copy className="size-4" />
          </button>
          <button
            type="button"
            className="btn-ghost p-1.5"
            title="横向拆分"
            aria-label="横向拆分"
            disabled={locked}
            onClick={() => split.mutate("horizontal")}
          >
            <SplitSquareVertical className="size-4" />
          </button>
          <button
            type="button"
            className="btn-ghost p-1.5"
            title="纵向拆分"
            aria-label="纵向拆分"
            disabled={locked}
            onClick={() => split.mutate("vertical")}
          >
            <SplitSquareHorizontal className="size-4" />
          </button>
          {onDelete && (
            <button
              type="button"
              className="btn-ghost p-1.5 text-red-500"
              aria-label="删除分镜"
              disabled={locked}
              onClick={() => onDelete(panel.id)}
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>

      {panel.sourceSpan && (
        <details className="rounded-lg border border-[var(--border)] p-2">
          <summary className="cursor-pointer text-xs font-medium">故事原文</summary>
          <p className="muted mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs">{panel.sourceSpan.text}</p>
          <Link
            to="/projects/$projectId/chapters/$chapterId"
            params={{ projectId, chapterId: data.page.chapterId }}
            hash="source"
            className="text-xs underline"
          >
            在章节中查看
          </Link>
        </details>
      )}

      <div className="flex gap-1">
        {panel.approvalStatus !== "approved" && !locked && (
          <button
            type="button"
            className="btn-secondary flex-1"
            onClick={() => patchPanel.mutate({ approvalStatus: "approved" })}
          >
            审核通过
          </button>
        )}
        {panel.approvalStatus === "approved" && (
          <button
            type="button"
            className="btn-secondary flex-1"
            onClick={() => patchPanel.mutate({ approvalStatus: "draft" })}
          >
            撤销审核
          </button>
        )}
        {panel.approvalStatus === "approved" && (
          <button
            type="button"
            className="btn-secondary flex-1"
            onClick={() => patchPanel.mutate({ approvalStatus: "locked" })}
          >
            <Lock className="size-3.5" /> 锁定
          </button>
        )}
        {locked && <p className="muted text-xs">已锁定分镜仅支持查看。</p>}
      </div>

      {draftFields.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          <div className="font-medium">正在使用预先准备的提示词</div>
          <p className="mt-1">
            “准备本页提示词”已生成 {draftFields.map(editorLabel).join("、")}{" "}
            ，编译后的提示词将采用这些文本，替代下方对应字段
            {draftHasContinuity ? "（连续性描述会追加到你填写的内容后）" : ""}。丢弃这些文本后将使用此处填写的内容。
          </p>
          <button
            type="button"
            className="btn-ghost mt-1 text-xs"
            disabled={locked || patchPanel.isPending}
            onClick={() => patchPanel.mutate({ promptDraft: null })}
          >
            丢弃预先准备的文本
          </button>
        </div>
      )}

      <AltText panelId={panel.id} pageId={data.page.id} value={panel.altText ?? null} />

      <fieldset disabled={locked} className="space-y-3">
        <Field label="故事节拍">
          <textarea className="input" rows={2} value={spec.beat} onChange={(e) => setField("beat", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="景别">
            <select
              className="input"
              value={spec.shotType}
              onChange={(e) => setField("shotType", e.target.value as PanelSpec["shotType"])}
            >
              {ShotType.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </Field>
          <Field label="机位角度">
            <select
              className="input"
              value={spec.cameraAngle}
              onChange={(e) => setField("cameraAngle", e.target.value as PanelSpec["cameraAngle"])}
            >
              {CameraAngle.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <div className="label">分镜中的角色</div>
          <div className="flex flex-wrap gap-1">
            {data.cast.map((c) => {
              const a = attached.find((x) => x.characterId === c.id);
              const stale = a && c.currentVersionId && a.id !== c.currentVersionId;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={Boolean(a)}
                  onClick={() => toggleCharacter(c)}
                  className={clsx("chip border", a ? "border-accent-500 bg-accent-600/15" : "border-[var(--border)]")}
                  title={stale ? "已关联较旧的外观版本" : undefined}
                >
                  {c.name}
                  {a && (
                    <span className="muted">
                      v{a.versionNumber}
                      {stale ? "（旧版）" : ""}
                    </span>
                  )}
                </button>
              );
            })}
            {!data.cast.length && <span className="muted text-xs">本项目暂无角色。</span>}
          </div>
        </div>
        {spec.characters.map((pc, i) => {
          const name = data.cast.find((c) => c.id === pc.characterId)?.name ?? "角色";
          // Planned specs name a character by its story key until it is edited here.
          const wearing = outfits.data?.characters.find(
            (c) => c.characterId === pc.characterId || c.analysisKey === pc.characterId,
          );
          const upd = (k: "expression" | "pose" | "action" | "outfit" | "position", v: string) =>
            setField(
              "characters",
              spec.characters.map((x, j) => (j === i ? { ...x, [k]: v } : x)),
            );
          return (
            <div key={pc.characterId} className="rounded-lg border border-[var(--border)] p-2">
              <div className="mb-1 text-xs font-medium">{name}</div>
              <div className="grid grid-cols-2 gap-1.5">
                {(["expression", "pose", "action", "outfit", "position"] as const).map((k) => (
                  <input
                    key={k}
                    className="input text-xs"
                    placeholder={editorLabel(k)}
                    aria-label={`${name} ${editorLabel(k)}`}
                    value={pc[k]}
                    onChange={(e) => upd(k, e.target.value)}
                  />
                ))}
              </div>
              {wearing && (
                <OutfitPicker
                  projectId={projectId}
                  panelId={panel.id}
                  entry={wearing}
                  locked={locked}
                  invalidate={[qk.panel(panel.id), ["prompt-preview", panel.id]]}
                />
              )}
            </div>
          );
        })}

        <Field label="地点">
          <select
            className="input"
            value={
              locations.data?.find(
                (l) =>
                  l.currentVersionId === panel.locationVersionId || l.currentVersion?.id === panel.locationVersionId,
              )?.id ?? ""
            }
            onChange={(e) => {
              const loc = locations.data?.find((l) => l.id === e.target.value);
              patchPanel.mutate({ locationVersionId: loc?.currentVersionId ?? null });
              setField("locationId", loc?.id);
            }}
          >
            <option value="">无</option>
            {locations.data?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>

        {/*
          The API and the prompt have always taken props; only the editor never sent them, so a prop reached a
          panel exactly once — when AI planning put it there — and could never be added or removed by hand.
        */}
        {isStrip && (
          // Vertical strips only: the seam belongs to the panel that follows it, so a scene change is authored on
          // the panel that opens the new scene. The first panel of a strip ignores its own seam.
          <Field
            label="本分镜上方的衔接"
            hint="设置条漫中本分镜与前一分镜的衔接方式。尺寸以条漫像素计，留空使用项目间距。"
          >
            <div className="grid grid-cols-2 gap-1.5">
              <select
                className="input text-xs"
                aria-label="衔接方式"
                value={seam?.kind ?? "gap"}
                onChange={(e) => {
                  const kind = e.target.value as NonNullable<EditorPanel["seam"]>["kind"];
                  patchPanel.mutate({ seam: kind === "gap" && !seam?.size ? null : { ...seam, kind } });
                }}
              >
                <option value="gap">留白 · 分隔节拍</option>
                <option value="butt">无间距 · 连续动作</option>
                <option value="bleed">重叠 · 硬边</option>
                <option value="dissolve">重叠 · 混合</option>
                <option value="fade">经指定颜色淡入淡出</option>
              </select>
              <input
                className="input text-xs"
                type="number"
                min={0}
                max={2000}
                step={10}
                aria-label="衔接尺寸（像素）"
                placeholder="尺寸（像素）"
                value={seam?.size ?? ""}
                onChange={(e) => {
                  const size = e.target.value === "" ? undefined : Math.max(0, Number(e.target.value));
                  patchPanel.mutate({ seam: { kind: seam?.kind ?? "gap", ...seam, size } });
                }}
              />
            </div>
            {seam?.kind === "fade" && (
              <input
                className="input mt-1.5 text-xs"
                aria-label="过渡颜色"
                placeholder="#000000（默认使用条漫背景色）"
                value={seam.color ?? ""}
                onChange={(e) => {
                  const color = e.target.value.trim();
                  patchPanel.mutate({ seam: { ...seam, color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : undefined } });
                }}
              />
            )}
          </Field>
        )}

        <Field label="道具" hint="关联道具的描述会写入提示词，并发送对应参考图。">
          <div className="flex flex-wrap gap-1">
            {props.data?.map((p) => {
              const attached = p.currentVersionId ? panel.propVersionIds.includes(p.currentVersionId) : false;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={!p.currentVersionId}
                  aria-pressed={attached}
                  onClick={() =>
                    patchPanel.mutate({
                      propVersionIds: attached
                        ? panel.propVersionIds.filter((v) => v !== p.currentVersionId)
                        : [...panel.propVersionIds, p.currentVersionId!],
                    })
                  }
                  className={clsx(
                    "chip border",
                    attached ? "border-accent-500 bg-accent-600/15" : "border-[var(--border)]",
                  )}
                >
                  {p.name}
                </button>
              );
            })}
            {!props.data?.length && <span className="muted text-xs">本项目暂无道具。</span>}
          </div>
        </Field>

        {(["composition", "foreground", "midground", "background", "lighting", "emotion", "action"] as const).map(
          (k) => (
            <Field key={k} label={editorLabel(k)}>
              <input className="input" value={spec[k] ?? ""} onChange={(e) => setField(k, e.target.value)} />
            </Field>
          ),
        )}
        <Field label="连续性要求">
          <TagInput
            value={spec.continuityRequirements}
            onChange={(v) => setField("continuityRequirements", v)}
            placeholder="例如，左袖破损"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="留白区域">
            <select
              className="input"
              value={spec.negativeSpace?.area ?? ""}
              onChange={(e) =>
                setField(
                  "negativeSpace",
                  e.target.value
                    ? { area: e.target.value, purpose: spec.negativeSpace?.purpose ?? "dialogue" }
                    : undefined,
                )
              }
            >
              <option value="">无</option>
              {areas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Field>
          <Field label="用途">
            <select
              className="input"
              disabled={!spec.negativeSpace}
              value={spec.negativeSpace?.purpose ?? "dialogue"}
              onChange={(e) =>
                spec.negativeSpace &&
                setField("negativeSpace", { ...spec.negativeSpace, purpose: e.target.value as "dialogue" })
              }
            >
              <option value="dialogue">对白</option>
              <option value="narration">旁白</option>
              <option value="sfx">拟声词</option>
            </select>
          </Field>
        </div>
        <Directing
          value={spec.direction}
          figures={data.cast
            .filter((c) => attached.some((a) => a.characterId === c.id))
            .map((c) => ({ id: c.id, name: c.name }))}
          onChange={(direction) => setSpec((s) => ({ ...s, direction }))}
        />
        <button
          type="button"
          className="btn-primary w-full"
          disabled={saveSpec.isPending}
          onClick={() => saveSpec.mutate()}
        >
          保存分镜设定
        </button>
      </fieldset>

      <Effects key={panel.id} panelId={panel.id} value={panel.effects} locked={locked} invalidate={inv} />

      <ImageTools
        panelId={panel.id}
        cast={data.cast.filter((c) => attached.some((a) => a.characterId === c.id)).map((c) => c.name)}
        hasArt={Boolean(panel.activeArtworkAssetId)}
        locked={locked}
        invalidate={inv}
      />

      <CompareModels panelId={panel.id} locked={locked} invalidate={inv} />

      <CoverageSheet panelId={panel.id} pageId={data.page.id} locked={locked} />

      <LayoutGuide
        panel={panel}
        locked={locked}
        aspect={(panel.frame.width * data.page.width) / (panel.frame.height * data.page.height)}
        invalidate={[...inv, ["prompt-preview", panel.id]]}
      />

      <PanelShape panelId={panel.id} disabled={locked} />

      <VideoShot panel={panel} locked={locked} onPatch={(video) => patchPanel.mutate({ video })} />

      <ClipPanel panelId={panel.id} video={panel.video ?? null} locked={locked} invalidate={inv} />

      {panel.artwork && (
        <div className="space-y-2 rounded-lg border border-[var(--border)] p-2">
          <div className="label">图片裁剪（原图始终保留）</div>
          <div className="flex flex-wrap gap-1">
            <AdjustImageButton panelId={panel.id} disabled={locked} />
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={locked}
              onClick={() =>
                useEditor.getState().commit((d) => ({
                  ...d,
                  panels: d.panels.map((p) =>
                    p.id === panel.id ? { ...p, imageTransform: { focalX: 0.5, focalY: 0.5, scale: 1 } } : p,
                  ),
                }))
              }
            >
              重置
            </button>
          </div>
          <ImageZoom panelId={panel.id} />
          <p className="muted text-xs">
            也可双击页面上的分镜，拖动图片调整位置，滚轮缩放。淡化区域表示裁剪范围之外，完成后按 Enter 或 Esc。
          </p>
          {(
            [
              ["focalX", "焦点 X", 0, 1, 0.01],
              ["focalY", "焦点 Y", 0, 1, 0.01],
              ["scale", "缩放", 1, 8, 0.05],
            ] as const
          ).map(([k, label, min, max, step]) => (
            <label key={k} className="flex items-center gap-2 text-xs">
              <span className="w-14">{label}</span>
              <input
                type="range"
                className="flex-1"
                min={min}
                max={max}
                step={step}
                value={transform[k]}
                disabled={locked}
                onChange={(e) => setTransform(k, Number(e.target.value))}
              />
              <span className="w-10 text-right tabular-nums">{transform[k].toFixed(2)}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** A rough sketch, pose or thumbnail for this panel, sent with its generation as a layout reference. */
function LayoutGuide({
  panel,
  locked,
  aspect,
  invalidate,
}: {
  panel: EditorPanel;
  locked: boolean;
  aspect: number;
  invalidate: readonly (readonly unknown[])[];
}) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const g = panel.guide;
  const guideTool = useAction((tool: "clean" | "lineart") => post(`/panels/${panel.id}/guide/tools`, { tool }), {
    invalidate,
    success: "已清理布局引导图",
  });
  const setGuide = useAction((guide: PanelGuide | null) => patch(`/panels/${panel.id}`, { guide }), {
    invalidate,
    success: "已保存布局引导图",
  });
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("strength", g?.strength ?? "loose");
      await api(`/panels/${panel.id}/guide`, { method: "POST", body: form });
      toast.success("已设置布局引导图");
      for (const key of invalidate) qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
    }
  };
  return (
    <fieldset disabled={locked} className="space-y-2 rounded-lg border border-[var(--border)] p-2">
      <div className="label mb-0">布局引导图</div>
      <p className="muted text-xs">
        可使用草图、火柴人姿势图或缩略图。生成和重新生成时，仅参考其构图、取景与姿势，人物面孔和服装仍依据已审核参考图。局部重绘不使用此图。使用自定义提示词时仍会发送图片，其用途由你填写的文本说明。
      </p>
      <div className="flex items-center gap-2">
        {g && (
          <AssetImage
            assetId={g.assetId}
            alt="布局引导图"
            fit="contain"
            className="size-20 shrink-0 rounded border border-[var(--border)]"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          <label
            className={clsx(
              "btn-secondary cursor-pointer text-xs",
              (uploading || locked) && "pointer-events-none opacity-50",
            )}
          >
            {uploading ? <Spinner /> : <ImagePlus className="size-3.5" />} {g ? "替换草图" : "上传草图"}
            <input
              type="file"
              className="sr-only"
              accept="image/png,image/jpeg,image/webp"
              disabled={uploading || locked}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={uploading || locked}
            onClick={() => setDrawing(true)}
          >
            <PencilLine className="size-3.5" /> {g ? "编辑绘图" : "绘制引导图"}
          </button>
          {g && (
            <>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={uploading || locked || guideTool.isPending}
                title="将灰色纸张和污渍转为白色，将笔画转为纯黑色"
                onClick={() => guideTool.mutate("clean")}
              >
                清理
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={uploading || locked || guideTool.isPending}
                title="仅保留图片线条"
                onClick={() => guideTool.mutate("lineart")}
              >
                提取线稿
              </button>
            </>
          )}
          <BoardGuidePicker
            panelId={panel.id}
            strength={g?.strength ?? "loose"}
            disabled={uploading || locked}
            invalidate={invalidate}
          />
          {g && (
            <button
              type="button"
              className="btn-ghost text-xs text-red-500"
              disabled={setGuide.isPending}
              onClick={() => setGuide.mutate(null)}
            >
              <Trash2 className="size-3.5" /> 移除
            </button>
          )}
        </div>
      </div>
      {g && (
        <Field label="遵循程度">
          <select
            className="input text-xs"
            value={g.strength}
            onChange={(e) => setGuide.mutate({ ...g, strength: e.target.value as PanelGuide["strength"] })}
          >
            <option value="loose">宽松，存在差异时以分镜描述为准</option>
            <option value="strict">严格，保留构图、取景与姿势</option>
          </select>
        </Field>
      )}
      {g && (
        <Field label="姿势文字描述（可选）">
          <textarea
            key={`${panel.id}-${g.pose ?? ""}`}
            className="input text-xs"
            rows={2}
            maxLength={800}
            placeholder="例如，一人居中站立，全身入镜，面向观众，双手叉腰"
            defaultValue={g.pose ?? ""}
            onBlur={(e) => {
              const pose = e.target.value.trim();
              if (pose !== (g.pose ?? "")) setGuide.mutate({ ...g, pose });
            }}
          />
        </Field>
      )}
      {g && (
        <DescribePose
          panelId={panel.id}
          current={g.pose ?? ""}
          disabled={locked}
          onApply={(pose) => setGuide.mutate({ ...g, pose })}
        />
      )}
      {drawing && (
        <GuideDrawer
          panelId={panel.id}
          aspect={aspect}
          guide={g ?? null}
          artworkId={panel.artwork?.id ?? null}
          onClose={() => setDrawing(false)}
          onSaved={() => {
            for (const key of invalidate) qc.invalidateQueries({ queryKey: key });
          }}
        />
      )}
    </fieldset>
  );
}

const MOTIONS: [ShotVideo["motion"], string][] = [
  ["auto", "自动（根据景别变化）"],
  ["static", "静止"],
  ["push-in", "推近"],
  ["pull-out", "拉远"],
  ["pan-left", "向左平移"],
  ["pan-right", "向右平移"],
  ["pan-up", "向上平移"],
  ["pan-down", "向下平移"],
];

/** The panel as a video shot (panel cut): its camera move, the fade into it, and whether it is in the video at all. */
function VideoShot({
  panel,
  locked,
  onPatch,
}: {
  panel: EditorPanel;
  locked: boolean;
  onPatch: (video: ShotVideo) => void;
}) {
  const projectId = useProjectId();
  const v = ShotVideo.parse(panel.video ?? {});
  const set = (patch: Partial<ShotVideo>) => onPatch({ ...v, ...patch });
  return (
    <fieldset disabled={locked} className="space-y-2 rounded-lg border border-[var(--border)] p-2">
      <div className="flex items-center gap-2">
        <span className="label mb-0">视频镜头</span>
        <PreviewVideoButton
          projectId={projectId}
          scope={{ panelId: panel.id }}
          label="预览镜头"
          title="预览 · 当前镜头"
          className="btn-ghost ml-auto text-xs"
        />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Field label="镜头运动">
          <select
            className="input text-xs"
            value={v.motion}
            onChange={(e) => set({ motion: e.target.value as ShotVideo["motion"] })}
          >
            {MOTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="切入当前镜头">
          <select
            className="input text-xs"
            value={v.fade}
            onChange={(e) => set({ fade: e.target.value as ShotVideo["fade"] })}
          >
            <option value="auto">项目默认</option>
            <option value="on">经黑场淡入淡出</option>
            <option value="off">硬切</option>
          </select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={v.disabled} onChange={(e) => set({ disabled: e.target.checked })} />
        视频中排除此镜头及其旁白
      </label>
      <Field label="单独设置最短停留时间（秒）" hint="留空时使用导出设置的最短时间，实际时长始终不少于旁白。">
        <input
          key={`${panel.id}-${v.holdMs ?? ""}`}
          className="input text-xs"
          type="number"
          min={0.5}
          max={60}
          step={0.5}
          placeholder="导出最短时间"
          defaultValue={v.holdMs != null ? v.holdMs / 1000 : ""}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            const holdMs = raw ? Math.min(60_000, Math.max(500, Math.round(Number(raw) * 1000))) : null;
            if (holdMs !== v.holdMs) set({ holdMs });
          }}
        />
      </Field>
    </fieldset>
  );
}

/** Art that needs a human look, e.g. generated on the fallback provider after a content-policy block. */
function ReviewBadge({
  panelId,
  review,
  invalidate,
}: {
  panelId: string;
  review: { message: string };
  invalidate: readonly (readonly unknown[])[];
}) {
  const dismiss = useAction(() => post(`/panels/${panelId}/review/dismiss`), {
    invalidate,
    success: "已标记为已审核",
  });
  return (
    <button
      type="button"
      className="chip bg-violet-500/15 text-violet-700 dark:text-violet-300"
      title={`${review.message} 点击标记为已审核。`}
      disabled={dismiss.isPending}
      onClick={() => dismiss.mutate()}
    >
      待审核
    </button>
  );
}

type Qa = {
  verdict: "ok" | "mismatch";
  problems: string[];
  notes?: string;
  stale?: boolean;
  model?: string;
  checkedAt?: string;
  /** What the project's visual checks did about a failure: a re-roll queued, or why not. */
  autoFix?: { jobId?: string; attempt?: number; skipped?: string };
};

/** Result of the automatic cast/headcount check, plus a manual "check now". */
function QaBadge({ panelId, qa, hasArt }: { panelId: string; qa: Qa | null; hasArt: boolean }) {
  // Falls back to a text key of the caller's; the project's configured vision key still takes priority server-side.
  const aiText = useAiBody("text");
  const check = useAction(() => post(`/panels/${panelId}/check`, aiText()), { success: "一致性检查已加入队列" });
  if (!hasArt) return null;
  // A mismatch names its first problem, so a stray sign in the art is not reported as a wrong cast.
  const label = !qa
    ? "not checked"
    : qa.stale
      ? "check outdated"
      : qa.verdict === "ok"
        ? "检查通过"
        : `${qa.problems[0] ?? "不一致"}${qa.problems.length > 1 ? ` +${qa.problems.length - 1}` : ""}${qa.autoFix?.jobId ? " · 正在重绘" : ""}`;
  const cls =
    qa?.verdict === "mismatch" && !qa.stale
      ? "chip bg-amber-500/15 text-amber-700 dark:text-amber-300"
      : qa?.verdict === "ok" && !qa.stale
        ? "chip bg-emerald-500/15 text-emerald-600"
        : "chip";
  const title = qa
    ? `${qa.problems.length ? qa.problems.join("；") : "角色及人数符合预期"}${qa.notes ? `。${qa.notes}` : ""}${qa.model ? ` · ${qa.model}` : ""}${qa.autoFix?.jobId ? `。正在自动重绘（第 ${qa.autoFix.attempt} 次）` : qa.autoFix?.skipped ? `。未重绘，${qa.autoFix.skipped}` : ""}`
    : "视觉模型检查图片中的角色是否符合预期，并定位人脸以安排气泡位置";
  // Never checked: a real button, so it reads as something to do rather than a status.
  if (!qa)
    return (
      <button
        type="button"
        className="btn-secondary px-2 py-0.5 text-xs"
        disabled={check.isPending}
        title={title}
        onClick={() => check.mutate()}
      >
        <ScanEye className="size-3.5" /> {check.isPending ? "正在加入队列……" : "运行检查"}
      </button>
    );
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cls} title={title}>
        {label}
      </span>
      <button
        type="button"
        className="btn-ghost p-1"
        disabled={check.isPending}
        title="重新检查"
        aria-label="重新检查"
        onClick={() => check.mutate()}
      >
        <RefreshCw className={check.isPending ? "size-3.5 animate-spin" : "size-3.5"} />
      </button>
    </span>
  );
}

/**
 * What the panel shows, for readers who cannot see it (EPUB, readers). Left empty, it is made from the story beat,
 * the dialogue and the sound effects; editable even on a locked panel.
 */
function AltText({ panelId, pageId, value }: { panelId: string; pageId: string; value: string | null }) {
  const [text, setText] = useState(value ?? "");
  const suggested = useQuery({
    queryKey: ["alt-text", pageId],
    queryFn: () => get<{ panels: { panelId: string; suggested: string }[] }>(`/pages/${pageId}/alt-text`),
    select: (r) => r.panels.find((p) => p.panelId === panelId)?.suggested ?? "",
  });
  const save = useAction((altText: string | null) => patch(`/panels/${panelId}`, { altText }), {
    invalidate: [["alt-text", pageId]],
    success: "已保存替代文本",
  });
  const changed = text.trim() !== (value ?? "");
  return (
    <details className="text-sm">
      <summary className="cursor-pointer">替代文本{value ? "" : "（根据情节和文字生成）"}</summary>
      <div className="mt-1 space-y-1">
        <textarea
          className="input"
          rows={3}
          maxLength={2000}
          aria-label="替代文本"
          placeholder={suggested.data || "描述分镜画面"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className="btn-secondary py-1 text-xs"
            disabled={!changed || save.isPending}
            onClick={() => save.mutate(text.trim() || null)}
          >
            保存替代文本
          </button>
          {suggested.data && !text && (
            <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setText(suggested.data!)}>
              使用建议内容
            </button>
          )}
        </div>
      </div>
    </details>
  );
}
