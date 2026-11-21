import { ChevronDown, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { del, patch, put } from "../../api/client.ts";
import { useAction } from "../../api/hooks.ts";
import type { ChapterDetail } from "../../api/types.ts";
import { ConfirmDialog, TagInput } from "../../components/ui.tsx";
import { BulkGenerateButton } from "../pages/BulkGenerate.tsx";
import { useLocationStates } from "../world/LocationStates.tsx";

type Scene = ChapterDetail["scenes"][number];
type Option = { id: string; name: string };
const TEXT_FIELDS = [
  ["purpose", "目的"],
  ["opening", "开场"],
  ["progression", "推进"],
  ["climax", "高潮"],
  ["ending", "结尾"],
] as const;

function StateRows({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const rows = Object.entries(value);
  const setRow = (i: number, k: string, v: string) =>
    onChange(Object.fromEntries(rows.map((r, j) => (j === i ? [k, v] : r))));
  return (
    <div>
      <span className="label">{label}</span>
      <div className="space-y-1">
        {rows.map(([k, v], i) => (
          <div key={i} className="flex gap-1">
            <input
              className="input w-40"
              value={k}
              placeholder="状态对象"
              aria-label="状态对象"
              onChange={(e) => setRow(i, e.target.value, v)}
            />
            <input
              className="input"
              value={v}
              placeholder="状态内容"
              aria-label="状态值"
              onChange={(e) => setRow(i, k, e.target.value)}
            />
            <button
              type="button"
              className="btn-ghost"
              aria-label="移除状态"
              onClick={() => onChange(Object.fromEntries(rows.filter((_, j) => j !== i)))}
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => onChange({ ...value, [`subject ${rows.length + 1}`]: "" })}
        >
          <Plus className="size-3" /> 添加状态
        </button>
      </div>
    </div>
  );
}

export function SceneEditor({
  scene,
  locations,
  cast,
  onChanged,
  projectId,
}: {
  projectId?: string;
  scene: Scene;
  locations: Option[];
  cast: Option[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState(scene);
  const [beats, setBeats] = useState(scene.beats.map((b) => b.description));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useAction(
    async () => {
      const { beats: _b, id, projectId, chapterId, order, createdAt, updatedAt, ...body } = s;
      await patch(`/scenes/${id}`, body);
      await put(`/scenes/${id}/beats`, { beats: beats.filter((b) => b.trim()) });
    },
    { success: "场景已保存", onSuccess: onChanged },
  );
  const remove = useAction(() => del(`/scenes/${scene.id}`), { success: "场景已删除", onSuccess: onChanged });
  const text = (k: keyof Scene, label: string, multiline = false) => {
    const common = {
      value: String(s[k] ?? ""),
      onChange: (e: { target: { value: string } }) => setS({ ...s, [k]: e.target.value }),
    };
    return multiline ? (
      <label className="block">
        <span className="label">{label}</span>
        <textarea className="input min-h-14" {...common} />
      </label>
    ) : (
      <label className="block">
        <span className="label">{label}</span>
        <input className="input" {...common} />
      </label>
    );
  };

  return (
    <div className="rounded-lg border border-[var(--border)]">
      <div className="flex flex-wrap items-center">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 p-3 text-left"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <span className="font-medium">
            {scene.order}. {scene.title}
          </span>
          <span className="muted truncate text-xs">
            {[locations.find((l) => l.id === scene.locationId)?.name, scene.time, scene.weather]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <span className="muted ml-auto text-xs">{scene.beats.length} 个情节节点</span>
        </button>
        {projectId && (
          <div className="flex max-w-full flex-wrap items-center gap-1 px-2 pb-2 sm:pb-0">
            <BulkGenerateButton
              projectId={projectId}
              scope={{ sceneId: scene.id }}
              label="生成场景"
              className="btn-secondary px-2 py-1 text-xs"
            />
          </div>
        )}
      </div>
      {open && (
        <div className="space-y-3 border-t border-[var(--border)] p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {text("title", "标题")}
            <label className="block">
              <span className="label">地点</span>
              <select
                className="input"
                value={s.locationId ?? ""}
                onChange={(e) => setS({ ...s, locationId: e.target.value || null, locationStateId: null })}
              >
                <option value="">无</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            {text("time", "时间")}
            {text("weather", "天气")}
            {s.locationId && (
              <StatePick
                locationId={s.locationId}
                value={s.locationStateId}
                onChange={(v) => setS({ ...s, locationStateId: v })}
              />
            )}
          </div>
          {text("summary", "摘要", true)}
          <div>
            <span className="label">出场角色</span>
            <div className="flex flex-wrap gap-1">
              {cast.map((c) => {
                const on = s.characterIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    className={`chip border ${on ? "border-accent-500 bg-accent-500/15" : "border-[var(--border)]"}`}
                    onClick={() =>
                      setS({
                        ...s,
                        characterIds: on ? s.characterIds.filter((x) => x !== c.id) : [...s.characterIds, c.id],
                      })
                    }
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {TEXT_FIELDS.map(([k, l]) => (
              <div key={k}>{text(k, l, true)}</div>
            ))}
          </div>
          <div>
            <span className="label">连贯性备注</span>
            <TagInput
              value={s.continuityNotes}
              onChange={(v) => setS({ ...s, continuityNotes: v })}
              placeholder="例如，脱下外套、开始下雨……"
            />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <StateRows label="初始状态" value={s.initialState} onChange={(v) => setS({ ...s, initialState: v })} />
            <StateRows label="最终状态" value={s.finalState} onChange={(v) => setS({ ...s, finalState: v })} />
          </div>
          <div>
            <span className="label">连贯性变化</span>
            <TagInput value={s.continuityDeltas} onChange={(v) => setS({ ...s, continuityDeltas: v })} />
          </div>
          <div>
            <span className="label">情节节拍</span>
            <div className="space-y-1">
              {beats.map((b, i) => (
                <div key={i} className="flex gap-1">
                  <span className="muted w-6 pt-1.5 text-right text-xs">{i + 1}.</span>
                  <input
                    className="input"
                    value={b}
                    aria-label={`情节节点 ${i + 1}`}
                    onChange={(e) => setBeats(beats.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  <button
                    type="button"
                    className="btn-ghost"
                    aria-label="移除节拍"
                    onClick={() => setBeats(beats.filter((_, j) => j !== i))}
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              <button type="button" className="btn-ghost text-xs" onClick={() => setBeats([...beats, ""])}>
                <Plus className="size-3" /> 添加节拍
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
              保存场景
            </button>
            <button type="button" className="btn-ghost ml-auto text-red-500" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" /> 删除
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="删除场景？"
        danger
        confirmLabel="删除"
        busy={remove.isPending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
      >
        页面和画格会保留，场景关联将解除。
      </ConfirmDialog>
    </div>
  );
}

/** The place's state this scene shows: picked by hand, or left to its time, weather and chapter. */
function StatePick({
  locationId,
  value,
  onChange,
}: {
  locationId: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const states = useLocationStates(locationId);
  if (!states.data?.length) return null;
  return (
    <label className="block">
      <span className="label">地点状态</span>
      <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">按时间、天气和章节匹配</option>
        {states.data.map((st) => (
          <option key={st.id} value={st.id}>
            {st.name}
          </option>
        ))}
      </select>
    </label>
  );
}
