import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ImagePlus, Plus, Star, Trash2, X } from "lucide-react";
import { useState } from "react";
import { del, get, patch, post } from "../../api/client.ts";
import { useAction } from "../../api/hooks.ts";
import type { CharacterOutfitRow, Reference } from "../../api/types.ts";
import { Spinner } from "../../components/ui.tsx";
import { useAiBody } from "../ai/AiPicker.tsx";
import { changePlace, type OutfitChange } from "../pages/editor/OutfitPicker.tsx";
import { useProjectId } from "../project/ProjectLayout.tsx";

export function OutfitsEditor({
  characterId,
  versionId,
  outfits,
  references,
  onChanged,
}: {
  characterId: string;
  versionId: string | null;
  outfits: CharacterOutfitRow[];
  /** This version's references: which outfits already have one, and whether the design itself is approved. */
  references: Reference[];
  onChanged: () => void;
}) {
  const withReference = new Set(references.map((r) => r.outfitId).filter((x): x is string => Boolean(x)));
  // An outfit reference re-dresses the approved design, so that has to exist before any outfit can be generated.
  const hasApprovedDesign = references.some((r) => !r.outfitId && (r.status === "approved" || r.status === "locked"));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const opts = { onSuccess: onChanged };
  const add = useAction(
    () =>
      post(`/characters/${characterId}/outfits`, {
        name: name.trim(),
        description,
        isDefault: !outfits.length,
        characterVersionId: versionId,
      }),
    {
      onSuccess: () => {
        setName("");
        setDescription("");
        onChanged();
      },
    },
  );
  const update = useAction(
    ({ id, body }: { id: string; body: Partial<CharacterOutfitRow> }) => patch(`/character-outfits/${id}`, body),
    opts,
  );
  const remove = useAction((id: string) => del(`/character-outfits/${id}`), opts);
  const projectId = useProjectId();
  const timelineKey = ["character", characterId, "outfit-timeline"];
  const timeline = useQuery({
    queryKey: timelineKey,
    queryFn: () => get<{ timeline: OutfitChange[] }>(`/characters/${characterId}/outfit-timeline`),
    select: (r) => r.timeline,
  });
  const removeChange = useAction((id: string) => del(`/outfit-assignments/${id}`), { invalidate: [timelineKey] });
  const aiImage = useAiBody("image");
  const generate = useAction(
    (outfitId: string) =>
      post(`/character-versions/${versionId}/references/generate`, { kind: "outfit", outfitId, ...aiImage() }),
    { onSuccess: onChanged, success: "服装参考图已加入队列" },
  );
  return (
    <section className="card p-3">
      <h2 className="mb-2 text-sm font-semibold">服装</h2>
      {outfits.length > 0 && !hasApprovedDesign && (
        <p className="mb-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
          请先在 <strong>标准参考图</strong> 中生成并审核主参考图。服装参考图会以其为基础绘制，以保持面容和体型一致。
        </p>
      )}
      <ul className="space-y-2">
        {outfits.map((o) => (
          <li key={o.id} className="rounded-lg border border-[var(--border)] p-2">
            <div className="flex items-center gap-1">
              <input
                className="input py-1 text-sm font-medium"
                defaultValue={o.name}
                aria-label="服装名称"
                onBlur={(e) =>
                  e.target.value.trim() &&
                  e.target.value !== o.name &&
                  update.mutate({ id: o.id, body: { name: e.target.value.trim() } })
                }
              />
              <button
                type="button"
                className="btn-ghost p-1"
                aria-label={o.isDefault ? "默认服装" : "设为默认"}
                title={o.isDefault ? "默认" : "设为默认"}
                onClick={() => !o.isDefault && update.mutate({ id: o.id, body: { isDefault: true } })}
              >
                <Star className={`size-4 ${o.isDefault ? "fill-amber-400 text-amber-400" : ""}`} />
              </button>
              <button
                type="button"
                className="btn-ghost p-1"
                aria-label={`为“${o.name}”生成参考图`}
                title={
                  !versionId
                    ? "尚未选择版本"
                    : !hasApprovedDesign
                      ? "请先生成并审核角色主参考图，服装将以此绘制以保持面容一致"
                      : withReference.has(o.id)
                        ? `重新生成“${o.name}”的参考图`
                        : `生成“${o.name}”的参考图`
                }
                disabled={!versionId || !hasApprovedDesign || generate.isPending}
                onClick={() => generate.mutate(o.id)}
              >
                {generate.isPending ? (
                  <Spinner />
                ) : withReference.has(o.id) ? (
                  <ImagePlus className="size-4 text-emerald-600" />
                ) : (
                  <ImagePlus className="size-4" />
                )}
              </button>
              <button
                type="button"
                className="btn-ghost p-1 text-red-500"
                aria-label="删除服装"
                onClick={() => remove.mutate(o.id)}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <textarea
              className="input mt-1 min-h-12 text-xs"
              defaultValue={o.description}
              aria-label="服装描述"
              onBlur={(e) =>
                e.target.value !== o.description && update.mutate({ id: o.id, body: { description: e.target.value } })
              }
            />
          </li>
        ))}
      </ul>
      {outfits.length > 1 && (
        <div className="mt-3">
          <h3 className="label">服装变更</h3>
          {timeline.data?.length ? (
            <ul className="space-y-1 text-xs">
              {timeline.data.map((t) => (
                <li key={t.id} className="flex items-center gap-1">
                  <Link
                    to="/projects/$projectId/pages/$pageId"
                    params={{ projectId, pageId: t.pageId }}
                    search={{ panelId: t.panelId }}
                    className="muted shrink-0 tabular-nums hover:underline"
                    title={t.chapterTitle}
                  >
                    {changePlace(t)}
                  </Link>
                  <span className="min-w-0 flex-1 truncate">
                    {t.outfitName}
                    <span className="muted">{t.scope === "panel" ? " · 仅此画格" : " · 从此处开始"}</span>
                  </span>
                  <button
                    type="button"
                    className="btn-ghost p-0.5"
                    aria-label={`移除${changePlace(t)}换成“${t.outfitName}”的记录`}
                    disabled={removeChange.isPending}
                    onClick={() => removeChange.mutate(t.id)}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted text-xs">
              暂无变更，所有画格均使用默认服装。可在页面编辑器中切换某个画格的服装，并选择仅作用于该画格或从该画格开始生效。
            </p>
          )}
        </div>
      )}
      <form
        className="mt-2 space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <input
          className="input"
          placeholder="新服装名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="新服装名称"
        />
        <textarea
          className="input min-h-12 text-xs"
          placeholder="描述"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="新服装描述"
        />
        <button type="submit" className="btn-secondary w-full" disabled={!name.trim() || add.isPending}>
          <Plus className="size-4" /> 添加服装
        </button>
      </form>
    </section>
  );
}
