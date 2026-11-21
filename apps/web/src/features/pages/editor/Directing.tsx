import {
  CAMERA_HEIGHTS,
  FIGURE_DEPTHS,
  FIGURE_FACINGS,
  FIGURE_VIEWS,
  type FigureDirection,
  LENS_FEELS,
  type PanelDirection,
  SHOT_PURPOSES,
} from "@openmanga/schemas";
import { Field } from "../../../components/ui.tsx";
import { editorLabel } from "./labels.ts";

const lensLabels: Readonly<Record<string, string>> = { wide: "广角", normal: "标准" };

function Pick<T extends string>({
  name,
  labels,
  value,
  options,
  onChange,
  empty = "—",
}: {
  name: string;
  labels?: Readonly<Partial<Record<T, string>>>;
  /** What the empty choice reads as: the field's own name where no label sits above it. */
  empty?: string;
  value: T | undefined;
  options: readonly T[];
  onChange: (v: T | undefined) => void;
}) {
  return (
    <select
      className="input"
      aria-label={name}
      value={value ?? ""}
      onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}
    >
      <option value="">{empty}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? editorLabel(o)}
        </option>
      ))}
    </select>
  );
}

/**
 * Directing controls: optional staging for the panel's camera and for each figure in it. Empty fields leave the choice
 * to the beat and composition; saved with the panel spec, so a change marks drawn art out of date.
 */
export function Directing({
  value,
  figures,
  onChange,
}: {
  value: PanelDirection | undefined;
  figures: { id: string; name: string }[];
  onChange: (v: PanelDirection) => void;
}) {
  const d: PanelDirection = value ?? { figures: [] };
  const set = (patch: Partial<PanelDirection>) => onChange({ ...d, ...patch });
  const figure = (id: string) => d.figures.find((f) => f.characterId === id) ?? { characterId: id };
  const setFigure = (id: string, patch: Partial<FigureDirection>) => {
    const next = { ...figure(id), ...patch };
    const others = d.figures.filter((f) => f.characterId !== id);
    set({ figures: [...others, next] });
  };
  const set2 = d.cameraHeight || d.lens || d.depthOfField || d.purpose || d.focus || d.figures.length;
  return (
    <details className="rounded-lg border border-[var(--border)] p-2" open={Boolean(set2)}>
      <summary className="cursor-pointer text-sm font-medium">导演设置</summary>
      <div className="mt-2 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Field label="镜头高度">
            <Pick
              name="镜头高度"
              value={d.cameraHeight}
              options={CAMERA_HEIGHTS}
              onChange={(v) => set({ cameraHeight: v })}
            />
          </Field>
          <Field label="镜头视角">
            <Pick
              name="镜头视角"
              labels={lensLabels}
              value={d.lens}
              options={LENS_FEELS}
              onChange={(v) => set({ lens: v })}
            />
          </Field>
          <Field label="景深">
            <Pick
              name="景深"
              value={d.depthOfField}
              options={["deep", "shallow"] as const}
              onChange={(v) => set({ depthOfField: v })}
            />
          </Field>
          <Field label="镜头目的">
            <Pick name="镜头目的" value={d.purpose} options={SHOT_PURPOSES} onChange={(v) => set({ purpose: v })} />
          </Field>
        </div>
        <Field label="画面焦点">
          <input
            className="input"
            maxLength={200}
            placeholder="视线首先落在哪里"
            value={d.focus ?? ""}
            onChange={(e) => set({ focus: e.target.value || undefined })}
          />
        </Field>
        {figures.map((c) => {
          const f = figure(c.id);
          return (
            <fieldset key={c.id} className="space-y-1 rounded-md bg-[var(--panel-2)] p-2">
              <legend className="px-1 text-xs font-medium">{c.name}</legend>
              <div className="grid grid-cols-3 gap-1">
                <Pick
                  name={`${c.name}的展示侧面`}
                  value={f.view}
                  options={FIGURE_VIEWS}
                  empty="展示侧面"
                  onChange={(v) => setFigure(c.id, { view: v })}
                />
                <Pick
                  name={`${c.name}的朝向`}
                  value={f.facing}
                  options={FIGURE_FACINGS}
                  empty="朝向"
                  onChange={(v) => setFigure(c.id, { facing: v })}
                />
                <Pick
                  name={`${c.name}的景深层次`}
                  value={f.depth}
                  options={FIGURE_DEPTHS}
                  empty="景深层次"
                  onChange={(v) => setFigure(c.id, { depth: v })}
                />
              </div>
              <div className="grid grid-cols-2 gap-1">
                <input
                  className="input text-xs"
                  aria-label={`${c.name}的视线`}
                  placeholder="视线，例如看向某个角色"
                  maxLength={200}
                  value={f.eyeLine ?? ""}
                  onChange={(e) => setFigure(c.id, { eyeLine: e.target.value || undefined })}
                />
                <input
                  className="input text-xs"
                  aria-label={`${c.name}的手持物品`}
                  placeholder="手持物品，例如右手持剑"
                  maxLength={200}
                  value={f.holding ?? ""}
                  onChange={(e) => setFigure(c.id, { holding: e.target.value || undefined })}
                />
              </div>
            </fieldset>
          );
        })}
      </div>
    </details>
  );
}
