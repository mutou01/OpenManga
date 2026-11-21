import { useQuery } from "@tanstack/react-query";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { del, get, patch, post } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import type { ChapterListItem, Reference } from "../../api/types.ts";
import { Spinner } from "../../components/ui.tsx";
import { useAiBody } from "../ai/AiPicker.tsx";
import { useProjectId } from "../project/ProjectLayout.tsx";

export type LocationState = {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  fromChapterId: string | null;
  untilChapterId: string | null;
  scenes: { id: string; title: string }[];
};
export const statesKey = (locationId: string) => ["location", locationId, "项状态"] as const;
export const useLocationStates = (locationId: string) =>
  useQuery({
    queryKey: statesKey(locationId),
    queryFn: () => get<{ states: LocationState[] }>(`/locations/${locationId}/states`),
    select: (r) => r.states,
    enabled: Boolean(locationId),
  });

/**
 * A place's states over story time: what differs from its design, the scene times and weather that pick each, and the
 * chapters it holds in; each can get its own reference image, drawn from the approved design.
 */
export function LocationStates({
  locationId,
  versionId,
  references,
  onChanged,
}: {
  locationId: string;
  versionId: string | null;
  references: Reference[];
  onChanged: () => void;
}) {
  const projectId = useProjectId();
  const q = useLocationStates(locationId);
  const chapters = useQuery({
    queryKey: qk.chapters(projectId),
    queryFn: () => get<{ chapters: ChapterListItem[] }>(`/projects/${projectId}/chapters`),
    select: (r) => r.chapters,
  });
  const inv = { invalidate: [statesKey(locationId)] };
  const [name, setName] = useState("");
  const add = useAction(() => post(`/locations/${locationId}/states`, { name: name.trim() }), {
    ...inv,
    onSuccess: () => setName(""),
  });
  const update = useAction(
    ({ id, body }: { id: string; body: Partial<LocationState> }) => patch(`/location-states/${id}`, body),
    inv,
  );
  const remove = useAction((id: string) => del(`/location-states/${id}`), {
    ...inv,
    onSuccess: onChanged,
  });
  const aiImage = useAiBody("image");
  const generate = useAction(
    (locationStateId: string) =>
      post(`/location-versions/${versionId}/references/generate`, { kind: "location", locationStateId, ...aiImage() }),
    { onSuccess: onChanged, success: "状态参考图已加入队列" },
  );
  const withReference = new Set(references.map((r) => r.locationStateId).filter(Boolean));
  const hasDesign = references.some((r) => !r.locationStateId && (r.status === "approved" || r.status === "locked"));
  const chapterSelect = (s: LocationState, field: "fromChapterId" | "untilChapterId", label: string) => (
    <select
      className="input py-1 text-xs"
      aria-label={`${label} (${s.name})`}
      value={s[field] ?? ""}
      onChange={(e) => update.mutate({ id: s.id, body: { [field]: e.target.value || null } })}
    >
      <option value="">{field === "fromChapterId" ? "从开头开始" : "直到结尾"}</option>
      {chapters.data?.map((c) => (
        <option key={c.id} value={c.id}>
          {field === "fromChapterId" ? "起始" : "截止"}第 {c.order} 章
        </option>
      ))}
    </select>
  );
  return (
    <section className="card p-3" aria-label="地点状态">
      <h2 className="text-sm font-semibold">故事进程中的状态</h2>
      <p className="muted mb-2 text-xs">
        记录地点在毁坏、积雪、夜间等情况下的变化。场景优先使用手动选择的状态，其次匹配时间或天气关键词，再按章节范围选择。该场景的画格会呈现当时的地点状态。
      </p>
      {q.isLoading && <Spinner />}
      <ul className="space-y-2">
        {q.data?.map((s) => (
          <li key={s.id} className="space-y-1 rounded-lg border border-[var(--border)] p-2">
            <div className="flex items-center gap-1">
              <input
                className="input py-1 text-sm font-medium"
                defaultValue={s.name}
                aria-label="状态名称"
                onBlur={(e) =>
                  e.target.value.trim() &&
                  e.target.value.trim() !== s.name &&
                  update.mutate({ id: s.id, body: { name: e.target.value.trim() } })
                }
              />
              <button
                type="button"
                className="btn-ghost p-1"
                aria-label={`为“${s.name}”生成参考图`}
                title={
                  !versionId
                    ? "尚未选择版本"
                    : hasDesign
                      ? "基于已审核设计绘制，保持地点特征一致"
                      : "当前仅依据描述绘制，请先审核主参考图以保持地点特征一致"
                }
                disabled={!versionId || generate.isPending}
                onClick={() => generate.mutate(s.id)}
              >
                <ImagePlus className={`size-4 ${withReference.has(s.id) ? "text-emerald-600" : ""}`} />
              </button>
              <button
                type="button"
                className="btn-ghost p-1 text-red-500"
                aria-label={`删除状态“${s.name}”`}
                onClick={() => remove.mutate(s.id)}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <textarea
              className="input min-h-12 text-xs"
              placeholder="变化描述，例如屋顶坍塌、表面覆满灰烬……"
              defaultValue={s.description}
              aria-label={`变化说明（${s.name}）`}
              onBlur={(e) =>
                e.target.value !== s.description && update.mutate({ id: s.id, body: { description: e.target.value } })
              }
            />
            <input
              className="input py-1 text-xs"
              placeholder="场景时间或天气关键词，例如夜晚、下雪"
              defaultValue={s.keywords.join(", ")}
              aria-label={`时间或天气关键词（${s.name}）`}
              onBlur={(e) => {
                const keywords = e.target.value
                  .split(",")
                  .map((k) => k.trim())
                  .filter(Boolean);
                if (keywords.join(",") !== s.keywords.join(",")) update.mutate({ id: s.id, body: { keywords } });
              }}
            />
            <div className="grid grid-cols-2 gap-1">
              {chapterSelect(s, "fromChapterId", "起始章节")}
              {chapterSelect(s, "untilChapterId", "截止章节")}
            </div>
            {s.scenes.length > 0 && (
              <p className="muted text-xs">手动选择此状态的场景 {s.scenes.map((x) => x.title).join(", ")}</p>
            )}
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <input
          className="input"
          placeholder="新状态，例如火灾之后"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          aria-label="新状态名称"
        />
        <button type="submit" className="btn-secondary" disabled={!name.trim() || add.isPending}>
          <Plus className="size-4" /> 添加
        </button>
      </form>
    </section>
  );
}
