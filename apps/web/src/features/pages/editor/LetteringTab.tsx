import {
  applySfxDefaults,
  applyTypeStyle,
  refitBubble,
  resolveLettering,
  type TailDirection,
  tailTargetToward,
} from "@openmanga/domain/browser";
import type { Bubble, BubbleType, SfxStyle } from "@openmanga/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { Crosshair, MessageSquarePlus, Minimize2, Paintbrush, ScanFace, Trash2, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { del, patch, post } from "../../../api/client.ts";
import { qk, useAction } from "../../../api/hooks.ts";
import type { PageDocument } from "../../../api/types.ts";
import { ConfirmDialog, clsx, toast } from "../../../components/ui.tsx";
import { CheckPanelsButton } from "../../generation/CheckPanels.tsx";
import { useProject } from "../../project/ProjectLayout.tsx";
import { editorLabel } from "./labels.ts";
import { type DocBubble, type DocSfx, useEditor } from "./store.ts";

const TYPES: BubbleType[] = ["normal", "thought", "shout", "whisper", "narration", "system"];

function useLettering() {
  return resolveLettering(useProject().data?.project.settings);
}

/** Selecting from the sidebar puts transformer handles on the canvas item; canvas selection scrolls the card into view. */
function useSelectableCard(type: "bubble" | "sfx", id: string, selected: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected && !ref.current?.contains(document.activeElement)) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return {
    ref,
    onPointerDown: () => !selected && useEditor.getState().select({ type, ids: [id] }),
    onFocus: () => !selected && useEditor.getState().select({ type, ids: [id] }),
  };
}

/** Percent-of-page number input for geometry. */
function Pct({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-1">
      {label}
      <input
        type="number"
        className="input px-1 text-xs"
        step={0.5}
        min={0}
        max={100}
        aria-label={`${label}（占页面百分比）`}
        value={Math.round(value * 1000) / 10}
        onChange={(e) => e.target.value !== "" && onChange(Math.min(1, Math.max(0, Number(e.target.value) / 100)))}
      />
    </label>
  );
}

function CommitInput({
  value,
  onCommit,
  label,
  multiline,
}: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  const props = {
    className: "input",
    "aria-label": label,
    value: draft,
    onBlur: commit,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
  };
  return multiline ? (
    <textarea
      {...props}
      rows={2}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          commit();
        }
      }}
    />
  ) : (
    <input {...props} onKeyDown={(e) => e.key === "Enter" && commit()} />
  );
}

const TAIL_PAD: (TailDirection | null)[] = [
  "up-left",
  "up",
  "up-right",
  "left",
  null,
  "right",
  "down-left",
  "down",
  "down-right",
];
const TAIL_ARROW: Record<TailDirection, string> = {
  "up-left": "↖",
  up: "↑",
  "up-right": "↗",
  left: "←",
  right: "→",
  "down-left": "↙",
  down: "↓",
  "down-right": "↘",
};

function TailControls({
  bubbleId,
  bubble: b,
  onChange,
}: {
  bubbleId: string;
  bubble: Bubble;
  onChange: (p: Partial<Bubble>) => void;
}) {
  const aiming = useEditor((s) => s.aimTailFor === bubbleId);
  return (
    <div className="col-span-2 space-y-1.5 rounded-md bg-[var(--panel-2)] p-1.5">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={b.tail} onChange={(e) => onChange({ tail: e.target.checked })} /> 尾巴
        </label>
        <button
          type="button"
          className={clsx("btn-ghost ml-auto py-0.5 text-xs", aiming && "bg-accent-500 text-white")}
          aria-pressed={aiming}
          title="然后点击页面中说话者的位置"
          onClick={() => {
            const st = useEditor.getState();
            st.select({ type: "bubble", ids: [bubbleId] });
            st.setAimTail(aiming ? null : bubbleId);
          }}
        >
          <Crosshair className="size-3.5" /> {aiming ? "点击页面上的说话者……" : "指向说话者"}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <fieldset className="grid shrink-0 grid-cols-[repeat(3,1.75rem)] gap-0.5" aria-label="尾巴方向">
          {TAIL_PAD.map((d, i) =>
            d ? (
              <button
                key={d}
                type="button"
                className="flex size-7 items-center justify-center rounded text-sm leading-none hover:bg-[var(--border)] focus-visible:outline-2 focus-visible:outline-accent-500"
                aria-label={`尾巴指向${editorLabel(d)}`}
                onClick={() => onChange({ tail: true, tailTarget: tailTargetToward(b, d) })}
              >
                {TAIL_ARROW[d]}
              </button>
            ) : (
              <span key={`c${i}`} />
            ),
          )}
        </fieldset>
        <p className="muted text-[11px] leading-tight">
          可选择方向、使用“指向说话者”，或拖动页面上的蓝色圆点。移动气泡时尾巴尖端位置保持固定。
        </p>
      </div>
    </div>
  );
}

function BubbleEditor({ item, data, selected }: { item: DocBubble; data: PageDocument; selected: boolean }) {
  const { commit } = useEditor.getState();
  const lettering = useLettering();
  const card = useSelectableCard("bubble", item.id, selected);
  const W = data.page.width;
  const H = data.page.height;
  const fit = (text: string, bb: Bubble) => refitBubble(text, bb, W, H, lettering.maxWidth);
  const update = (fn: (bb: Bubble, text: string) => Partial<{ bubble: Bubble; text: string }>) =>
    commit((d) => ({
      ...d,
      bubbles: d.bubbles.map((b) => (b.id === item.id ? { ...b, ...fn(b.bubble, b.text) } : b)),
    }));
  const setBubble = (patchB: Partial<Bubble>, refit = false) =>
    update((bb, text) => {
      const next = { ...bb, ...patchB };
      return { bubble: refit && lettering.autoFit ? fit(text, next) : next };
    });
  const setText = (text: string) => update((bb) => ({ text, bubble: lettering.autoFit ? fit(text, bb) : bb }));
  const line = data.dialogue.find((l) => l.id === item.id);
  const inv = [qk.page(data.page.id)];
  const speaker = useAction((characterId: string | null) => patch(`/dialogue/${item.id}`, { characterId }), {
    invalidate: inv,
  });
  const remove = useAction(() => del(`/dialogue/${item.id}`), { invalidate: inv });
  const b = item.bubble;
  return (
    <div
      {...card}
      className={clsx(
        "cursor-pointer space-y-2 rounded-lg border p-2",
        selected ? "border-accent-500 ring-1 ring-accent-500" : "border-[var(--border)]",
      )}
    >
      {item.kind === "narration" ? (
        <p className="text-xs">
          <span className="chip bg-amber-500/15">旁白框</span> {item.text}{" "}
          <span className="muted">（请在旁白页面编辑文本）</span>
        </p>
      ) : (
        <CommitInput label="对白文本" value={item.text} onCommit={setText} multiline />
      )}
      <div className="grid grid-cols-2 gap-1.5 text-xs">
        <select
          className="input text-xs"
          aria-label="气泡类型"
          value={b.type}
          onChange={(e) =>
            update((bb, text) => {
              const type = e.target.value as BubbleType;
              const next = {
                ...applyTypeStyle(bb, lettering, type),
                tail: !["narration", "system"].includes(type) && bb.tail,
              };
              return { bubble: lettering.autoFit ? fit(text, next) : next };
            })
          }
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {item.kind === "dialogue" && (
          <select
            className="input text-xs"
            aria-label="说话者"
            value={line?.characterId ?? ""}
            onChange={(e) => speaker.mutate(e.target.value || null)}
          >
            <option value="">无说话者</option>
            {data.cast.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1">
          字号{" "}
          <input
            type="number"
            className="input text-xs"
            min={8}
            max={120}
            value={b.fontSize}
            onChange={(e) => setBubble({ fontSize: Number(e.target.value) || b.fontSize }, true)}
          />
        </label>
        <label className="flex items-center gap-1">
          <select
            className="input text-xs"
            aria-label="对齐"
            value={b.align}
            onChange={(e) => setBubble({ align: e.target.value as Bubble["align"] })}
          >
            <option value="left">左对齐</option>
            <option value="center">居中</option>
            <option value="right">右对齐</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          填充{" "}
          <input
            type="color"
            value={b.background}
            onChange={(e) => setBubble({ background: e.target.value })}
            aria-label="背景颜色"
          />
        </label>
        <label className="flex items-center gap-1">
          文本{" "}
          <input
            type="color"
            value={b.textColor}
            onChange={(e) => setBubble({ textColor: e.target.value })}
            aria-label="文本颜色"
          />
        </label>
        <label className="flex items-center gap-1">
          边框{" "}
          <input
            type="color"
            value={b.borderColor}
            onChange={(e) => setBubble({ borderColor: e.target.value })}
            aria-label="边框颜色"
          />
        </label>
        <div />
        <label className="col-span-2 flex items-center gap-1">
          字体{" "}
          <select className="input text-xs" value={b.font} onChange={(e) => setBubble({ font: e.target.value }, true)}>
            <option>Comic Neue</option>
            <option>DejaVu Sans</option>
          </select>
        </label>
        {b.type !== "narration" && b.type !== "system" && (
          <TailControls bubbleId={item.id} bubble={b} onChange={(p) => setBubble(p)} />
        )}
        <Pct label="横坐标" value={b.x} onChange={(x) => setBubble({ x: Math.min(x, 1 - b.width) })} />
        <Pct label="纵坐标" value={b.y} onChange={(y) => setBubble({ y: Math.min(y, 1 - b.height) })} />
        <Pct
          label="宽度"
          value={b.width}
          onChange={(w) => setBubble({ width: Math.max(0.02, Math.min(w, 1 - b.x)) })}
        />
        <Pct
          label="高度"
          value={b.height}
          onChange={(h) => setBubble({ height: Math.max(0.02, Math.min(h, 1 - b.y)) })}
        />
      </div>
      <div className="flex flex-wrap gap-1 text-xs">
        <button
          type="button"
          className="btn-ghost py-0.5 text-xs"
          title="调整文本框大小以适应文本"
          onClick={() => update((bb, text) => ({ bubble: fit(text, bb) }))}
        >
          <Minimize2 className="size-3.5" /> 适应文本
        </button>
        <button
          type="button"
          className="btn-ghost py-0.5 text-xs"
          title={`应用项目默认的“${editorLabel(b.type)}”样式`}
          onClick={() =>
            update((bb, text) => {
              const next = applyTypeStyle(bb, lettering);
              return { bubble: lettering.autoFit ? fit(text, next) : next };
            })
          }
        >
          <Paintbrush className="size-3.5" /> 默认样式
        </button>
        {item.kind === "dialogue" && (
          <button type="button" className="btn-ghost py-0.5 text-xs text-red-500" onClick={() => remove.mutate()}>
            <Trash2 className="size-3.5" /> 删除气泡
          </button>
        )}
      </div>
    </div>
  );
}

function SfxEditor({ item, pageId, selected }: { item: DocSfx; pageId: string; selected: boolean }) {
  const { commit } = useEditor.getState();
  const lettering = useLettering();
  const card = useSelectableCard("sfx", item.id, selected);
  const set = (p: Partial<SfxStyle>) =>
    commit((d) => ({ ...d, sfx: d.sfx.map((s) => (s.id === item.id ? { ...s, style: { ...s.style, ...p } } : s)) }));
  const remove = useAction(() => del(`/sfx/${item.id}`), { invalidate: [qk.page(pageId)] });
  const st = item.style;
  return (
    <div
      className={clsx(
        "cursor-pointer space-y-2 rounded-lg border p-2 text-xs",
        selected ? "border-accent-500 ring-1 ring-accent-500" : "border-[var(--border)]",
      )}
      {...card}
    >
      <CommitInput
        label="拟声词文本"
        value={item.text}
        onCommit={(text) => commit((d) => ({ ...d, sfx: d.sfx.map((s) => (s.id === item.id ? { ...s, text } : s)) }))}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <label className="flex items-center gap-1">
          字号{" "}
          <input
            type="number"
            className="input text-xs"
            min={8}
            max={400}
            value={st.fontSize}
            onChange={(e) => set({ fontSize: Number(e.target.value) || st.fontSize })}
          />
        </label>
        <label className="flex items-center gap-1">
          描边宽度{" "}
          <input
            type="number"
            className="input text-xs"
            min={0}
            max={30}
            value={st.strokeWidth}
            onChange={(e) => set({ strokeWidth: Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-1">
          填充{" "}
          <input
            type="color"
            value={st.fill}
            onChange={(e) => set({ fill: e.target.value })}
            aria-label="拟声词填充色"
          />
        </label>
        <label className="flex items-center gap-1">
          描边{" "}
          <input
            type="color"
            value={st.stroke}
            onChange={(e) => set({ stroke: e.target.value })}
            aria-label="拟声词描边颜色"
          />
        </label>
        <label className="col-span-2 flex items-center gap-1">
          旋转{" "}
          <input
            type="range"
            className="flex-1"
            min={-180}
            max={180}
            value={st.rotation}
            onChange={(e) => set({ rotation: Number(e.target.value) })}
          />
        </label>
        <label className="col-span-2 flex items-center gap-1">
          缩放{" "}
          <input
            type="range"
            className="flex-1"
            min={0.2}
            max={4}
            step={0.05}
            value={st.scale}
            onChange={(e) => set({ scale: Number(e.target.value) })}
          />
        </label>
        <label className="col-span-2 flex items-center gap-1">
          不透明度{" "}
          <input
            type="range"
            className="flex-1"
            min={0.1}
            max={1}
            step={0.05}
            value={st.opacity}
            onChange={(e) => set({ opacity: Number(e.target.value) })}
          />
        </label>
        <Pct label="横坐标" value={st.x} onChange={(x) => set({ x })} />
        <Pct label="纵坐标" value={st.y} onChange={(y) => set({ y })} />
      </div>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className="btn-ghost py-0.5"
          onClick={() =>
            commit((d) => ({
              ...d,
              sfx: d.sfx.map((s) => (s.id === item.id ? { ...s, style: applySfxDefaults(s.style, lettering) } : s)),
            }))
          }
        >
          <Paintbrush className="size-3.5" /> 默认样式
        </button>
        <button type="button" className="btn-ghost py-0.5 text-red-500" onClick={() => remove.mutate()}>
          <Trash2 className="size-3.5" /> 删除拟声词
        </button>
      </div>
    </div>
  );
}

export function LetteringTab({ data, panelId }: { data: PageDocument; panelId: string | null }) {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const [text, setText] = useState("");
  const [type, setType] = useState<BubbleType>("normal");
  const [speaker, setSpeaker] = useState("");
  const [sfxText, setSfxText] = useState("");
  const inv = [qk.page(data.page.id)];
  const addBubble = useAction(
    () => post(`/pages/${data.page.id}/dialogue`, { panelId, text, type, characterId: speaker || null }),
    { invalidate: inv, onSuccess: () => setText("") },
  );
  const addSfx = useAction(() => post(`/pages/${data.page.id}/sfx`, { panelId, text: sfxText }), {
    invalidate: inv,
    onSuccess: () => setSfxText(""),
  });
  const qc = useQueryClient();
  const [scope, setScope] = useState<"page" | "chapter" | "project">("page");
  const [applying, setApplying] = useState(false);
  const applyDefaults = async (restyle: boolean) => {
    setApplying(true);
    try {
      await useEditor.getState().flush();
      const r = await post<{ pages: number; bubbles: number; narration: number; sfx: number }>(
        `/pages/${data.page.id}/lettering/apply-defaults`,
        { scope, restyle, fit: true },
      );
      toast.success(
        `已${restyle ? "更新样式并适配" : "适配"} ${r.pages} 页中的 ${r.bubbles + r.narration} 个文本框${restyle ? `及 ${r.sfx} 个拟声词` : ""}`,
      );
      await qc.invalidateQueries({ queryKey: ["page"] });
    } catch (e) {
      toast.error(e);
    }
    setApplying(false);
  };
  const fitFaces = async () => {
    setApplying(true);
    try {
      await useEditor.getState().flush();
      const r = await post<{ panels: number; bubbles: number; captions: number; withoutFaces: number }>(
        `/pages/${data.page.id}/lettering/fit-faces`,
        { scope },
      );
      toast.success(
        `已在 ${r.panels} 个分镜中将 ${r.bubbles + r.captions} 个文本框移出人脸区域` +
          (r.withoutFaces ? `。另有 ${r.withoutFaces} 个分镜缺少人脸数据，请先运行一致性检查。` : ""),
      );
      await qc.invalidateQueries({ queryKey: ["page"] });
    } catch (e) {
      toast.error(e);
    }
    setApplying(false);
  };
  const [confirmClear, setConfirmClear] = useState(false);
  const clearLettering = async () => {
    setApplying(true);
    try {
      await useEditor.getState().flush();
      const r = await post<{ pages: number; bubbles: number; sfx: number; captions: number }>(
        `/pages/${data.page.id}/lettering/clear`,
        { scope },
      );
      toast.success(`已从 ${r.pages} 页中移除 ${r.bubbles} 个气泡、${r.captions} 条字幕及 ${r.sfx} 个拟声词`);
      useEditor.getState().select(null);
      await qc.invalidateQueries({ queryKey: ["page"] });
    } catch (e) {
      toast.error(e);
    }
    setApplying(false);
    setConfirmClear(false);
  };
  // With auto-placement off, a chapter plan keeps its dialogue and SFX on each panel instead of lettering them.
  const planned = data.panels.reduce(
    (n, p) =>
      p.plannedLettering && p.approvalStatus !== "locked"
        ? { lines: n.lines + p.plannedLettering.dialogue.length, sfx: n.sfx + p.plannedLettering.sfx.length }
        : n,
    { lines: 0, sfx: 0 },
  );
  const letterFromPlan = useAction(
    async () => {
      await useEditor.getState().flush();
      return post<{ lines: number; sfx: number }>(`/pages/${data.page.id}/letter-from-plan`);
    },
    { invalidate: [["page"]], success: (r) => `已按规划放置 ${r.lines} 个气泡和 ${r.sfx} 个拟声词` },
  );
  const bubbles = doc.bubbles.filter((b) => !panelId || b.panelId === panelId);
  const sfx = doc.sfx.filter((s) => !panelId || s.panelId === panelId);
  const isSel = (t: string, id: string) => selection?.type === t && selection.ids.includes(id);

  return (
    <div className="space-y-4 text-sm">
      <p className="muted text-xs">
        {panelId ? "正在显示所选分镜的对白排版。" : "正在显示整页对白排版。选择一个分镜可向其中添加新元素。"}{" "}
        对白采用矢量排版，修改无需图片调用费用。在此处或页面上点击元素可移动、缩放，拖动两侧手柄可调整宽度。
      </p>
      {planned.lines + planned.sfx > 0 && (
        <div className="rounded-lg border border-accent-500/40 bg-accent-600/10 p-2 text-xs">
          <div className="font-medium">章节规划已为本页生成文本</div>
          <p className="muted mt-1">
            {planned.lines} 句{planned.lines === 1 ? "" : "s"} 对白和 {planned.sfx}{" "}
            个拟声词。自动排版已关闭，可按规划预留位置放置气泡，之后继续移动或编辑。
          </p>
          <button
            type="button"
            className="btn-secondary mt-1 w-full text-xs"
            disabled={letterFromPlan.isPending}
            onClick={() => letterFromPlan.mutate()}
          >
            <MessageSquarePlus className="size-3.5" /> 按规划排版
          </button>
        </div>
      )}
      <details className="rounded-lg border border-[var(--border)] p-2 text-xs">
        <summary className="cursor-pointer font-medium">默认样式与批量操作</summary>
        <div className="mt-2 space-y-2">
          <p className="muted">在“项目设置 → 对白排版”中设置各类型的字体、字号和颜色，再应用到已有文本。</p>
          <select
            className="input text-xs"
            aria-label="应用范围"
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            <option value="page">当前页面</option>
            <option value="chapter">整个章节</option>
            <option value="project">整个项目</option>
          </select>
          <div className="flex gap-1">
            <button
              type="button"
              className="btn-secondary flex-1 text-xs"
              disabled={applying}
              onClick={() => applyDefaults(false)}
            >
              <Minimize2 className="size-3.5" /> 让文本框适应文本
            </button>
            <button
              type="button"
              className="btn-secondary flex-1 text-xs"
              disabled={applying}
              onClick={() => applyDefaults(true)}
            >
              <Paintbrush className="size-3.5" /> 应用样式并适配文本
            </button>
          </div>
          <button
            type="button"
            className="btn-secondary w-full text-xs"
            disabled={applying}
            onClick={fitFaces}
            title="根据一致性检查定位的人脸移动气泡和字幕，并将尾巴指向说话者"
          >
            <ScanFace className="size-3.5" /> 移开遮挡人脸的气泡
          </button>
          <div className="flex flex-wrap items-center gap-1">
            <CheckPanelsButton
              projectId={data.page.projectId}
              scope={
                scope === "page"
                  ? { pageId: data.page.id }
                  : scope === "chapter"
                    ? { chapterId: data.page.chapterId }
                    : {}
              }
              label={`检查分镜（${editorLabel(scope)}）`}
              className="btn-secondary flex-1 text-xs"
            />
          </div>
          <button
            type="button"
            className="btn-secondary w-full text-xs text-red-500"
            disabled={applying}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 className="size-3.5" /> 移除所有气泡、字幕和拟声词
          </button>
        </div>
      </details>
      <ConfirmDialog
        open={confirmClear}
        danger
        busy={applying}
        title="移除对白排版？"
        confirmLabel="移除对白排版"
        onClose={() => setConfirmClear(false)}
        onConfirm={clearLettering}
      >
        将删除所有对话气泡和拟声词，并隐藏旁白字幕，范围为{" "}
        {scope === "page" ? "当前页面" : scope === "chapter" ? "本章所有页面" : "项目中的所有页面"}
        。图片、旁白文本和音频将保留，此操作无法撤销。
      </ConfirmDialog>
      <div className="space-y-2 rounded-lg border border-[var(--border)] p-2">
        <textarea
          className="input"
          rows={2}
          placeholder="输入新对白……"
          aria-label="新气泡文本"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex gap-1">
          <select
            className="input"
            aria-label="新气泡类型"
            value={type}
            onChange={(e) => setType(e.target.value as BubbleType)}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            className="input"
            aria-label="新气泡说话者"
            value={speaker}
            onChange={(e) => setSpeaker(e.target.value)}
          >
            <option value="">无说话者</option>
            {data.cast.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn-primary w-full"
          disabled={!text.trim() || addBubble.isPending}
          onClick={() => addBubble.mutate()}
        >
          <MessageSquarePlus className="size-4" /> 添加气泡
        </button>
      </div>
      <div className="flex gap-1">
        <input
          className="input"
          placeholder="拟声词（例如，砰）"
          aria-label="新拟声词"
          value={sfxText}
          onChange={(e) => setSfxText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sfxText.trim() && addSfx.mutate()}
        />
        <button
          type="button"
          className="btn-secondary"
          disabled={!sfxText.trim() || addSfx.isPending}
          onClick={() => addSfx.mutate()}
        >
          <Zap className="size-4" /> 添加
        </button>
      </div>
      {bubbles.map((b) => (
        <BubbleEditor key={b.id} item={b} data={data} selected={isSel("bubble", b.id)} />
      ))}
      {sfx.map((s) => (
        <SfxEditor key={s.id} item={s} pageId={data.page.id} selected={isSel("sfx", s.id)} />
      ))}
      {!bubbles.length && !sfx.length && <p className="muted text-xs">暂无对白排版。</p>}
    </div>
  );
}
