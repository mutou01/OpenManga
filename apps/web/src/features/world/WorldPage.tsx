import type { ImageDescription } from "@openmanga/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, RotateCcw } from "lucide-react";
import { useCallback, useState } from "react";
import { get, patch, post } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import type { LocationCard, ProjectStyleRow, PropCard, Reference, StylePresetRow } from "../../api/types.ts";
import {
  AssetImage,
  EmptyState,
  ErrorBox,
  fmt,
  Modal,
  PageHeader,
  SaveIndicator,
  Spinner,
  StatusChip,
  Tabs,
  toast,
  useAutosave,
} from "../../components/ui.tsx";
import { statusLabel } from "../../lib/locale.ts";
import { stylePresetText } from "../../lib/style-labels.ts";
import { ReferencePanel } from "../cast/ReferencePanel.tsx";
import { BulkGenerateButton } from "../pages/BulkGenerate.tsx";
import { useProject, useProjectId } from "../project/ProjectLayout.tsx";
import { DescribeImageButton } from "../vision/DescribeImageButton.tsx";

type Tab = "locations" | "props" | "style" | "notes";

export function WorldPage() {
  const [tab, setTab] = useState<Tab>("locations");
  return (
    <div className="p-6">
      <PageHeader title="世界" subtitle="管理重复出现的地点、道具、美术风格和世界笔记。" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "locations", label: "地点" },
          { value: "props", label: "道具" },
          { value: "style", label: "风格" },
          { value: "notes", label: "世界笔记" },
        ]}
      />
      {tab === "locations" && <EntityGrid kind="locations" />}
      {tab === "props" && <EntityGrid kind="props" />}
      {tab === "style" && <StyleTab />}
      {tab === "notes" && <NotesTab />}
    </div>
  );
}

function EntityGrid({ kind }: { kind: "locations" | "props" }) {
  const projectId = useProjectId();
  const [trash, setTrash] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const baseKey = kind === "locations" ? qk.locations(projectId) : qk.props(projectId);
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: [...baseKey, trash],
    queryFn: () =>
      get<Record<string, (LocationCard | PropCard)[]>>(`/projects/${projectId}/${kind}${trash ? "?trash=1" : ""}`),
  });
  const create = useAction(
    () => post(`/projects/${projectId}/${kind}`, { name: name.trim(), description: { summary } }),
    {
      invalidate: [baseKey],
      success: "已创建",
      onSuccess: () => {
        setCreating(false);
        setName("");
        setSummary("");
      },
    },
  );
  const restore = useAction((id: string) => post(`/${kind}/${id}/restore`), {
    invalidate: [baseKey],
    success: "已恢复",
  });
  const list = data?.[kind] ?? [];
  const singular = kind === "locations" ? "location" : "prop";
  const entityLabel = singular === "location" ? "地点" : "道具";
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> 新建{entityLabel}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setTrash(!trash)}>
          {trash ? "显示使用中" : "回收站"}
        </button>
        {!trash && list.length > 0 && (
          // The same count → price → confirm dialog as a chapter's "generate all panels", with its "only missing"
          // and provider-batch options, so a whole world can be drawn in one go instead of card by card.
          <BulkGenerateButton
            projectId={projectId}
            scope={{ references: singular }}
            label={`生成全部${entityLabel}参考图`}
            noun={{
              one: `${entityLabel}参考图`,
              many: `${entityLabel}参考图`,
              missing: `仅限缺少此类参考图的${entityLabel}`,
            }}
            kinds={
              singular === "location"
                ? [
                    { value: "location", label: "广角视图" },
                    { value: "location_panorama", label: "全景图" },
                    { value: "location_sheet", label: "各侧面设定图" },
                  ]
                : [
                    { value: "prop", label: "单视图" },
                    { value: "prop_multi_angle", label: "多角度视图" },
                  ]
            }
          />
        )}
      </div>
      <ErrorBox error={error} onRetry={() => refetch()} />
      {isLoading && <Spinner className="size-6" />}
      {data && !list.length && (
        <EmptyState title={trash ? "回收站为空" : `暂无${entityLabel}`}>
          {!trash && "故事分析会自动创建重复出现的地点与道具，重要的重复元素才需要参考图。"}
        </EmptyState>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {list.map((e) => (
          <div key={e.id} className="card overflow-hidden">
            <Link
              to={
                kind === "locations"
                  ? "/projects/$projectId/world/locations/$entityId"
                  : "/projects/$projectId/world/props/$entityId"
              }
              params={{ projectId, entityId: e.id }}
              className="block"
            >
              <AssetImage assetId={e.previewAssetId} alt={e.name} className="aspect-[4/3] w-full" trashed={trash} />
              <div className="space-y-1 p-3">
                <div className="truncate font-medium">{e.name}</div>
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  {e.currentVersion && (
                    <span className="muted">
                      v{e.currentVersion.versionNumber} {e.currentVersion.status}
                    </span>
                  )}
                  <StatusChip status={e.referenceStatus} label={`参考图：${statusLabel(e.referenceStatus)}`} />
                  <span className="muted">{e.appearances} 个画格</span>
                </div>
              </div>
            </Link>
            {trash && (
              <button
                type="button"
                className="btn-secondary m-3 mt-0 w-[calc(100%-1.5rem)] text-xs"
                onClick={() => restore.mutate(e.id)}
              >
                <RotateCcw className="size-3" /> 恢复
              </button>
            )}
          </div>
        ))}
      </div>
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={`新建${entityLabel}`}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCreating(false)}>
              取消
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!name.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              创建
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="label">名称</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">摘要</span>
            <textarea className="input min-h-20" value={summary} onChange={(e) => setSummary(e.target.value)} />
          </label>
        </div>
      </Modal>
    </>
  );
}

type StyleState = {
  currentStyleId: string | null;
  versions: (ProjectStyleRow & { preset: StylePresetRow | null })[];
  references: Reference[];
};

/** Every definition field that reaches the prompt, in the order styleSection() renders them. */
const STYLE_FIELDS = [
  ["summary", "摘要"],
  ["lineTreatment", "线条"],
  ["colorPolicy", "颜色"],
  ["shading", "明暗"],
  ["detailLevel", "细节"],
  ["faceRendering", "面部绘制"],
  ["backgroundRendering", "背景绘制"],
  ["motionEffects", "动态效果"],
  ["contrast", "对比度"],
  ["screenTones", "网点"],
  ["lighting", "光照风格"],
] as const;
type StyleField = (typeof STYLE_FIELDS)[number][0];

function StyleTab() {
  const projectId = useProjectId();
  const qc = useQueryClient();
  const style = useQuery({
    queryKey: qk.style(projectId),
    queryFn: () => get<StyleState>(`/projects/${projectId}/style`),
  });
  const presets = useQuery({
    queryKey: ["style-presets"],
    queryFn: () => get<{ presets: StylePresetRow[] }>("/style-presets"),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const current = style.data?.versions.find((v) => v.id === style.data.currentStyleId) ?? style.data?.versions[0];
  const [presetKey, setPresetKey] = useState<string | null | undefined>(undefined);
  const [custom, setCustom] = useState<string | undefined>(undefined);
  const [edits, setEdits] = useState<Partial<Record<StyleField, string>>>({});
  const [excl, setExcl] = useState<string | undefined>(undefined);
  const chosenKey = presetKey === undefined ? (current?.preset?.key ?? null) : presetKey;
  const customText = custom ?? current?.customDescription ?? "";
  // A style applied from a described image lives on a project-scoped preset, which /style-presets does not list;
  // the version query already joins it, so fall back to that rather than hiding the whole definition.
  const chosen =
    presets.data?.presets.find((p) => p.key === chosenKey) ??
    (current?.preset?.key === chosenKey ? current?.preset : null);
  const fieldValue = (k: StyleField) => edits[k] ?? chosen?.definition?.[k] ?? "";
  const exclText = excl ?? (chosen?.definition?.exclusions ?? []).join("\n");
  const edited = Object.keys(edits).length > 0 || excl !== undefined;
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: qk.style(projectId) }), [qc, projectId]);
  const makeCurrent = useAction((id: string) => post(`/project-styles/${id}/make-current`), {
    invalidate: [qk.style(projectId), qk.project(projectId)],
    success: "风格版本已恢复",
  });
  const apply = useAction(
    () =>
      post(`/projects/${projectId}/style`, {
        stylePresetKey: chosenKey,
        customDescription: customText,
        // Only sent when a field was touched: the endpoint mints a project-scoped preset from a definition, so
        // sending one unchanged would fork a "Custom" copy of a built-in preset on every apply.
        ...(edited
          ? {
              customDefinition: {
                ...chosen?.definition,
                ...edits,
                ...(excl === undefined
                  ? {}
                  : {
                      exclusions: excl
                        .split("\n")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    }),
              },
            }
          : {}),
      }),
    {
      invalidate: [qk.style(projectId), qk.project(projectId)],
      success: "已应用新风格版本",
      onSuccess: () => {
        setPresetKey(undefined);
        setCustom(undefined);
        setEdits({});
        setExcl(undefined);
      },
    },
  );
  if (style.isLoading || presets.isLoading) return <Spinner className="size-6" />;
  if (style.error || presets.error) return <ErrorBox error={style.error ?? presets.error} />;
  return (
    <div className="space-y-5">
      <section className="card p-4">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="mr-auto font-semibold">美术指导</h2>
          {current && (
            <span className="muted text-xs">
              当前版本 v{current.versionNumber} · {current.preset ? stylePresetText(current.preset).name : "自定义"}
            </span>
          )}
          <DescribeImageButton
            projectId={projectId}
            aspect="style"
            title="从图片提取美术风格"
            onUse={(d: ImageDescription) => {
              // Fills the editor rather than applying: the user reviews it and clicks "应用为新版本".
              const st = d.style ?? {};
              const lines = Object.entries(st)
                .filter(([, v]) => (Array.isArray(v) ? v.length : String(v ?? "").trim()))
                .map(
                  ([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${Array.isArray(v) ? v.join(", ") : v}`,
                );
              setPresetKey(null);
              setCustom(lines.join("\n"));
              toast.info("风格描述已填写，请检查后应用为新版本");
            }}
          />
          <button type="button" className="btn-primary" disabled={apply.isPending} onClick={() => apply.mutate()}>
            应用为新版本
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {presets.data?.presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setPresetKey(p.key);
                setEdits({});
              }}
              aria-pressed={p.key === chosenKey}
              className={`rounded-lg border p-2 text-left text-sm ${p.key === chosenKey ? "border-accent-500 bg-accent-500/10" : "border-[var(--border)] hover:bg-[var(--panel-2)]"}`}
            >
              <div className="font-medium">{stylePresetText(p).name}</div>
              <div className="muted line-clamp-2 text-xs">{stylePresetText(p).summary}</div>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPresetKey(null)}
            aria-pressed={chosenKey === null}
            className={`rounded-lg border p-2 text-left text-sm ${chosenKey === null ? "border-accent-500 bg-accent-500/10" : "border-[var(--border)]"}`}
          >
            <div className="font-medium">不使用预设</div>
            <div className="muted text-xs">仅使用自定义描述</div>
          </button>
        </div>
        <div className="mt-3">
          <div className="mb-1 flex items-baseline gap-2">
            <span className="label mb-0">风格定义</span>
            <span className="muted text-xs">
              {edited ? "已编辑，应用后将保存为自定义风格" : "以下每项都会用于图像提示词"}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {STYLE_FIELDS.map(([k, label]) => (
              <label key={k} className="block">
                <span className="muted text-xs">{label}</span>
                <textarea
                  className="input min-h-14 text-xs"
                  value={fieldValue(k)}
                  onChange={(e) => setEdits((p) => ({ ...p, [k]: e.target.value }))}
                />
              </label>
            ))}
            <label className="block sm:col-span-2">
              <span className="muted text-xs">避免内容，每行一项</span>
              <textarea
                className="input min-h-14 text-xs"
                value={exclText}
                placeholder="照片级写实渲染&#10;三维渲染效果"
                onChange={(e) => setExcl(e.target.value)}
              />
            </label>
          </div>
        </div>
        <label className="mt-3 block">
          <span className="label">项目专用风格描述</span>
          <textarea
            className="input min-h-20"
            value={customText}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="例如，暴雨氛围、青橙色调"
          />
        </label>
      </section>
      {current && (
        <ReferencePanel
          subject="style"
          versionPath="project-styles"
          versionId={current.id}
          versionStatus={current.status}
          references={style.data?.references ?? []}
          onChanged={refresh}
        />
      )}
      <section className="card p-4">
        <h2 className="mb-2 font-semibold">风格历史</h2>
        <ul className="space-y-1 text-sm">
          {style.data?.versions.map((v) => (
            <li key={v.id} className="flex items-center gap-2">
              <span className="font-medium">v{v.versionNumber}</span>
              <StatusChip status={v.status} />
              <span>{v.preset ? stylePresetText(v.preset).name : "自定义"}</span>
              <span className="muted truncate">{v.customDescription}</span>
              <span className="muted ml-auto text-xs">{fmt.date(v.createdAt)}</span>
              {v.id === style.data?.currentStyleId ? (
                <span className="muted text-xs">当前</span>
              ) : (
                // Applying a style always minted a new version, so comparing two meant retyping one by hand.
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  disabled={makeCurrent.isPending}
                  onClick={() => makeCurrent.mutate(v.id)}
                >
                  设为当前
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function NotesTab() {
  const projectId = useProjectId();
  const { data } = useProject();
  if (!data) return <Spinner />;
  return <NotesEditor key={projectId} projectId={projectId} initial={data.project.settings.worldNotes} />;
}

function NotesEditor({ projectId, initial }: { projectId: string; initial: string }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(initial);
  const { state } = useAutosave(notes, async (v) => {
    await patch(`/projects/${projectId}`, { settings: { worldNotes: v } });
    qc.invalidateQueries({ queryKey: qk.project(projectId) });
  });
  return (
    <section className="card p-4">
      <div className="mb-2 flex items-center">
        <h2 className="mr-auto font-semibold">世界笔记</h2>
        <SaveIndicator state={state} />
      </div>
      <p className="muted mb-2 text-xs">世界规则、阵营、科技、魔法和制服，会作为结构化上下文参与章节规划。</p>
      <textarea
        className="input min-h-80 font-mono text-sm"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        aria-label="世界笔记"
      />
    </section>
  );
}
