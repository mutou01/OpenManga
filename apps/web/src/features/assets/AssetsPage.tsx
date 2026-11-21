import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink, FileArchive, Images, Music, RotateCcw, Search, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { assetUrl, del, get, post, put } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import type { AssetRow, AssetVariantRow } from "../../api/types.ts";
import {
  AssetImage,
  ConfirmDialog,
  clsx,
  EmptyState,
  ErrorBox,
  Field,
  fmt,
  KeyValue,
  Modal,
  PageHeader,
  Spinner,
  StatusChip,
  TagInput,
} from "../../components/ui.tsx";
import { statusLabel } from "../../lib/locale.ts";
import { JsonBlock, kindLabel } from "../generation/shared.tsx";
import { useProjectId } from "../project/ProjectLayout.tsx";

const TYPE_LABELS: Record<string, string> = {
  character_reference: "角色参考图",
  location_reference: "场景参考图",
  prop_reference: "道具参考图",
  style_reference: "风格参考图",
  panel_art: "画格原画",
  panel_mask: "画格蒙版",
  cover: "封面",
  export: "导出文件",
  audio: "音频",
};
const assetTypeLabel = (type: string) => TYPE_LABELS[type] ?? type;

const TYPES = [
  "character_reference",
  "location_reference",
  "prop_reference",
  "style_reference",
  "panel_art",
  "panel_mask",
  "cover",
  "export",
  "audio",
];
type Detail = {
  asset: AssetRow;
  variants: AssetVariantRow[];
  lineage: { id: string; generationJobId: string | null; createdAt: string }[];
  children: { id: string; createdAt: string }[];
  source: {
    kind: "generated" | "uploaded" | "derived" | "made";
    job: {
      id: string;
      kind: string;
      provider: string | null;
      model: string | null;
      templateName: string | null;
      templateVersion: number | null;
    } | null;
    uploadedName: string | null;
    tool: string | null;
  };
  usedBy: { kind: string; label: string; panelId: string | null }[];
  marks: { tags: string[]; collections: string[]; favourite: boolean; licence: { text: string; url?: string } | null };
};
const SOURCE: Record<Detail["source"]["kind"], string> = {
  generated: "AI 生成",
  uploaded: "上传",
  derived: "由其他文件编辑或派生",
  made: "应用生成",
};

function Thumb({ a, className }: { a: AssetRow; className: string }) {
  if (a.mimeType.startsWith("image/"))
    return (
      <AssetImage assetId={a.id} alt={assetTypeLabel(a.type)} className={className} trashed={Boolean(a.deletedAt)} />
    );
  const Icon = a.mimeType.startsWith("audio/") ? Music : FileArchive;
  return (
    <div className={`flex items-center justify-center bg-[var(--panel-2)] ${className}`}>
      <Icon className="muted size-8" />
    </div>
  );
}

type LibraryAsset = AssetRow & {
  tags: string[];
  collections: string[];
  favourite: boolean;
  model: string | null;
};
type Library = {
  assets: LibraryAsset[];
  storage: { bytes: number; variant_bytes: number };
  facets: { tags: string[]; collections: string[]; models: string[] };
};
type View = "" | "favourite" | "unused" | "duplicates" | "trash";
type Entity = { id: string; name: string };

/**
 * The asset library: every file of the project, searchable by name, tag, character, place or prop and filtered by
 * source, model and date; favourites, collections, unused images and duplicate files; bulk actions; and, per file,
 * where it came from, what uses it and images that look like it.
 */
export function AssetsPage() {
  const projectId = useProjectId();
  const [f, setF] = useState({
    q: "",
    type: "",
    tag: "",
    collection: "",
    source: "",
    model: "",
    from: "",
    to: "",
    entity: "",
  });
  const [view, setView] = useState<View>("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkValue, setBulkValue] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const [kind, entityId] = f.entity.split(":");
  const params = new URLSearchParams({
    ...Object.fromEntries(Object.entries(f).filter(([k, v]) => v && k !== "entity")),
    ...(kind ? { [`${kind}Id`]: entityId! } : {}),
    trash: view === "trash" ? "1" : "0",
    ...(view === "favourite" ? { favourite: "1" } : view === "unused" || view === "duplicates" ? { view } : {}),
  });
  const q = useQuery({
    queryKey: [...qk.assets(projectId), params.toString()],
    queryFn: () => get<Library>(`/projects/${projectId}/assets?${params}`),
  });
  const entities = useQuery({
    queryKey: ["project", projectId, "asset-entities"],
    queryFn: async () => {
      const [c, l, p] = await Promise.all([
        get<{ characters: Entity[] }>(`/projects/${projectId}/characters`),
        get<{ locations: Entity[] }>(`/projects/${projectId}/locations`),
        get<{ props: Entity[] }>(`/projects/${projectId}/props`),
      ]);
      return { characters: c.characters, locations: l.locations, props: p.props };
    },
  });
  const bulk = useAction(
    (action: string) =>
      post<{ done: number; skipped: { reason: string }[] }>(`/projects/${projectId}/assets/bulk`, {
        ids: [...picked],
        action,
        ...(bulkValue.trim() ? { value: bulkValue.trim() } : {}),
      }),
    {
      invalidate: [qk.assets(projectId)],
      success: (r) =>
        `已完成 ${r.done} 项${r.skipped.length ? `，跳过 ${r.skipped.length} 项，原因为 ${r.skipped[0]!.reason}` : ""}`,
      onSuccess: () => setPicked(new Set()),
    },
  );
  const favourite = useAction((a: LibraryAsset) => put(`/assets/${a.id}/marks`, { favourite: !a.favourite }), {
    invalidate: [qk.assets(projectId)],
  });
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const facets = q.data?.facets;
  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader
        title="素材"
        subtitle={
          q.data
            ? `原始文件 ${fmt.bytes(q.data.storage.bytes)} · 派生文件 ${fmt.bytes(q.data.storage.variant_bytes)}`
            : "原始图片、音频与导出文件"
        }
      />
      <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="素材视图">
        {(
          [
            ["", "全部"],
            ["favourite", "收藏"],
            ["unused", "未使用"],
            ["duplicates", "重复文件"],
            ["trash", "回收站"],
          ] as [View, string][]
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            className={view === v ? "btn-primary" : "btn-secondary"}
            onClick={() => {
              setView(v);
              setPicked(new Set());
            }}
          >
            {v === "favourite" && <Star className="size-4" />}
            {v === "trash" && <Trash2 className="size-4" />}
            {label}
          </button>
        ))}
      </div>
      <div className="mb-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <input className="input" placeholder="搜索名称、类型或标签" aria-label="搜索" value={f.q} onChange={set("q")} />
        <select className="input" value={f.type} onChange={set("type")} aria-label="素材类型">
          <option value="">全部类型</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {assetTypeLabel(t)}
            </option>
          ))}
        </select>
        <select className="input" value={f.entity} onChange={set("entity")} aria-label="角色、场景或道具">
          <option value="">全部角色、场景与道具</option>
          {(
            [
              ["character", "角色", entities.data?.characters],
              ["location", "场景", entities.data?.locations],
              ["prop", "道具", entities.data?.props],
            ] as const
          ).map(([k, label, list]) =>
            list?.length ? (
              <optgroup key={k} label={label}>
                {list.map((e) => (
                  <option key={e.id} value={`${k}:${e.id}`}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            ) : null,
          )}
        </select>
        <select className="input" value={f.source} onChange={set("source")} aria-label="来源">
          <option value="">全部来源</option>
          <option value="generated">AI 生成</option>
          <option value="uploaded">上传</option>
          <option value="derived">编辑或派生</option>
        </select>
        <select className="input" value={f.model} onChange={set("model")} aria-label="模型">
          <option value="">全部模型</option>
          {facets?.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <div className="flex min-w-0 gap-1 sm:col-span-2 lg:col-span-2">
          <input
            className="input min-w-0 flex-1"
            type="date"
            aria-label="起始日期"
            value={f.from}
            onChange={set("from")}
          />
          <input className="input min-w-0 flex-1" type="date" aria-label="结束日期" value={f.to} onChange={set("to")} />
        </div>
        {Boolean(facets?.tags.length) && (
          <select className="input" value={f.tag} onChange={set("tag")} aria-label="标签">
            <option value="">全部标签</option>
            {facets!.tags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
        )}
        {Boolean(facets?.collections.length) && (
          <select className="input" value={f.collection} onChange={set("collection")} aria-label="合集">
            <option value="">全部合集</option>
            {facets!.collections.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
      </div>
      {picked.size > 0 && (
        <section
          aria-label="批量操作"
          className="card sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 p-2 text-sm"
        >
          <span className="font-medium">已选择 {picked.size} 项</span>
          <input
            className="input w-40 py-1"
            placeholder="标签或合集"
            aria-label="标签或合集"
            value={bulkValue}
            onChange={(e) => setBulkValue(e.target.value)}
          />
          {(
            [
              ["tag", "标签"],
              ["untag", "移除标签"],
              ["collect", "加入合集"],
              ["uncollect", "移出合集"],
            ] as const
          ).map(([a, label]) => (
            <button
              key={a}
              type="button"
              className="btn-secondary py-1"
              disabled={!bulkValue.trim() || bulk.isPending}
              onClick={() => bulk.mutate(a)}
            >
              {label}
            </button>
          ))}
          <button type="button" className="btn-secondary py-1" onClick={() => bulk.mutate("favourite")}>
            <Star className="size-4" /> 收藏
          </button>
          {view === "trash" ? (
            <button type="button" className="btn-secondary py-1" onClick={() => bulk.mutate("restore")}>
              <RotateCcw className="size-4" /> 恢复
            </button>
          ) : (
            <button type="button" className="btn-secondary py-1" onClick={() => bulk.mutate("trash")}>
              <Trash2 className="size-4" /> 移入回收站
            </button>
          )}
          <button type="button" className="btn-ghost py-1" onClick={() => setPicked(new Set())}>
            清空选择
          </button>
        </section>
      )}
      {view === "unused" && (
        <p className="muted mb-2 text-xs">没有用于画格原画、参考图、素材板、封面或缩略图的图片。</p>
      )}
      {view === "duplicates" && <p className="muted mb-2 text-xs">并排显示重复存储的文件。</p>}
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.assets.length ? (
        <EmptyState icon={<Images className="size-8" />} title={view === "trash" ? "回收站为空" : "没有匹配的素材"} />
      ) : (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="素材">
          {q.data.assets.map((a) => (
            <div
              key={a.id}
              className={clsx(
                "card relative overflow-hidden text-left hover:border-accent-500",
                picked.has(a.id) && "border-accent-500 ring-2 ring-accent-500/40",
              )}
            >
              <input
                type="checkbox"
                className="absolute top-2 left-2 z-[1] size-4"
                aria-label={`选择 ${assetTypeLabel(a.type)} ${a.id.slice(0, 8)}`}
                checked={picked.has(a.id)}
                onChange={() => toggle(a.id)}
              />
              <button
                type="button"
                className="absolute top-1.5 right-1.5 z-[1] rounded-full bg-[var(--panel)]/80 p-1"
                aria-label={a.favourite ? "取消收藏" : "收藏"}
                aria-pressed={a.favourite}
                onClick={() => favourite.mutate(a)}
              >
                <Star className={clsx("size-4", a.favourite && "fill-amber-400 text-amber-400")} />
              </button>
              <button type="button" className="block w-full text-left" onClick={() => setOpenId(a.id)}>
                <Thumb a={a} className="aspect-square w-full" />
                <div className="p-2 text-xs">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate font-medium">{assetTypeLabel(a.type)}</span>
                    <StatusChip status={a.status} />
                  </div>
                  <div className="muted">
                    {a.width ? `${a.width}×${a.height} · ` : ""}
                    {fmt.bytes(a.byteSize)}
                    {a.durationMs ? ` · ${fmt.ms(a.durationMs)}` : ""}
                  </div>
                  <div className="muted truncate">
                    {fmt.ago(a.createdAt)}
                    {a.model ? ` · ${a.model}` : ""}
                  </div>
                  {(a.tags.length > 0 || a.collections.length > 0) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {a.tags.map((t) => (
                        <span key={t} className="chip text-[10px]">
                          #{t}
                        </span>
                      ))}
                      {a.collections.map((t) => (
                        <span key={t} className="chip bg-accent-600/15 text-[10px]">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
              {a.mimeType.startsWith("audio/") && (
                // biome-ignore lint/a11y/useMediaCaption: narration transcript lives in the Narration page text
                <audio
                  controls
                  preload="none"
                  src={assetUrl(a.id, undefined, undefined, Boolean(a.deletedAt))}
                  className="w-full px-2 pb-2"
                />
              )}
            </div>
          ))}
        </section>
      )}
      {openId && (
        <AssetDetail
          id={openId}
          projectId={projectId}
          onClose={() => setOpenId(null)}
          onOpen={setOpenId}
          listKey={qk.assets(projectId)}
        />
      )}
    </div>
  );
}

function AssetDetail({
  id,
  projectId,
  onClose,
  onOpen,
  listKey,
}: {
  id: string;
  projectId: string;
  onClose: () => void;
  /** Open another asset (an image like this one). */
  onOpen: (id: string) => void;
  listKey: readonly unknown[];
}) {
  const [like, setLike] = useState(false);
  const similar = useQuery({
    queryKey: ["asset", id, "similar"],
    queryFn: () => get<{ similar: (AssetRow & { score: number })[] }>(`/assets/${id}/similar`),
    enabled: like,
  });
  const q = useQuery({ queryKey: ["asset", id], queryFn: () => get<Detail>(`/assets/${id}`) });
  const [confirm, setConfirm] = useState(false);
  const inv = [listKey, ["asset", id]] as const;
  const trash = useAction(() => post(`/assets/${id}/trash`), { invalidate: inv, success: "已移入回收站" });
  const restore = useAction(() => post(`/assets/${id}/restore`), { invalidate: inv, success: "已恢复" });
  const remove = useAction(() => del(`/assets/${id}`), {
    invalidate: [listKey],
    success: "已永久删除",
    onSuccess: onClose,
  });
  const saveMarks = useAction((m: Partial<Detail["marks"]>) => put(`/assets/${id}/marks`, m), {
    invalidate: [listKey, ["asset", id]],
  });
  const a = q.data?.asset;
  return (
    <Modal open onClose={onClose} title="素材" wide>
      {q.error && <ErrorBox error={q.error} />}
      {!a || !q.data ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {a.mimeType.startsWith("image/") ? (
              <AssetImage
                assetId={a.id}
                variant={null}
                alt={assetTypeLabel(a.type)}
                className="max-h-96 w-full rounded-lg"
                fit="contain"
                trashed={Boolean(a.deletedAt)}
              />
            ) : a.mimeType.startsWith("audio/") ? (
              // biome-ignore lint/a11y/useMediaCaption: narration transcript lives in the Narration page text
              <audio controls src={assetUrl(a.id, undefined, undefined, Boolean(a.deletedAt))} className="w-full" />
            ) : (
              <Thumb a={a} className="h-40 w-full rounded-lg" />
            )}
            <div className="space-y-3">
              <KeyValue
                items={[
                  ["类型", assetTypeLabel(a.type)],
                  [
                    "状态",
                    <StatusChip
                      key="s"
                      status={a.deletedAt ? "cancelled" : a.status}
                      label={a.deletedAt ? "已移入回收站" : statusLabel(a.status)}
                    />,
                  ],
                  ["MIME", a.mimeType],
                  ["大小", `${a.width ? `${a.width}×${a.height} · ` : ""}${fmt.bytes(a.byteSize)}`],
                  [
                    "SHA-256",
                    <code key="h" className="text-xs break-all">
                      {a.sha256}
                    </code>,
                  ],
                  ["创建时间", fmt.date(a.createdAt)],
                  [
                    "生成任务",
                    a.generationJobId ? (
                      <Link
                        key="g"
                        to="/projects/$projectId/generation/$jobId"
                        params={{ projectId, jobId: a.generationJobId }}
                        className="text-accent-500 hover:underline"
                      >
                        {a.generationJobId.slice(0, 8)}
                      </Link>
                    ) : (
                      "—"
                    ),
                  ],
                ]}
              />
              <div className="flex flex-wrap gap-2">
                <a
                  className="btn-secondary"
                  href={assetUrl(a.id, undefined, undefined, Boolean(a.deletedAt))}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="size-4" /> 查看原图
                </a>
                {a.deletedAt ? (
                  <>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => restore.mutate()}
                      disabled={restore.isPending}
                    >
                      <RotateCcw className="size-4" /> 恢复
                    </button>
                    <button type="button" className="btn-danger" onClick={() => setConfirm(true)}>
                      <Trash2 className="size-4" /> 永久删除
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => trash.mutate()}
                    disabled={trash.isPending}
                  >
                    <Trash2 className="size-4" /> 移入回收站
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <section aria-label="素材来源" className="space-y-1 text-sm">
              <h3 className="font-medium">素材来源</h3>
              <p>{SOURCE[q.data.source.kind]}</p>
              {q.data.source.job && (
                <p className="muted text-xs">
                  {kindLabel(q.data.source.job.kind)}
                  {q.data.source.job.provider ? ` · ${q.data.source.job.provider}` : ""}
                  {q.data.source.job.model ? ` · ${q.data.source.job.model}` : ""}
                  {q.data.source.job.templateName
                    ? ` · ${q.data.source.job.templateName} v${q.data.source.job.templateVersion}`
                    : ""}
                </p>
              )}
              {q.data.source.uploadedName && <p className="muted text-xs">来源文件 {q.data.source.uploadedName}</p>}
              {q.data.source.tool && <p className="muted text-xs">制作工具 {q.data.source.tool}</p>}
              <h3 className="pt-2 font-medium">使用位置</h3>
              {q.data.usedBy.length ? (
                <ul className="text-xs">
                  {q.data.usedBy.map((u) => (
                    <li key={`${u.kind}-${u.label}`}>
                      {u.kind === "panel" ? "画格" : u.kind === "reference" ? "参考素材" : ""} {u.label}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted text-xs">暂无使用位置。</p>
              )}
            </section>
            <section aria-label="归档" className="space-y-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={q.data.marks.favourite}
                  onChange={(e) => saveMarks.mutate({ favourite: e.target.checked })}
                />
                收藏
              </label>
              <Field label="标签">
                <TagInput
                  value={q.data.marks.tags}
                  onChange={(tags) => saveMarks.mutate({ tags })}
                  placeholder="添加标签"
                />
              </Field>
              <LicenceField
                key={JSON.stringify(q.data.marks.licence)}
                value={q.data.marks.licence}
                onSave={(licence) => saveMarks.mutate({ licence })}
              />
              <Field label="合集">
                <TagInput
                  value={q.data.marks.collections}
                  onChange={(collections) => saveMarks.mutate({ collections })}
                  placeholder="加入合集"
                />
              </Field>
            </section>
          </div>
          {a.mimeType.startsWith("image/") && (
            <section aria-label="相似图片" className="space-y-2">
              {!like ? (
                <button type="button" className="btn-secondary" onClick={() => setLike(true)}>
                  <Search className="size-4" /> 查找相似图片
                </button>
              ) : similar.isLoading ? (
                <Spinner />
              ) : (
                <>
                  <h3 className="text-sm font-medium">相似图片</h3>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {similar.data?.similar.map((s) => (
                      <button key={s.id} type="button" className="text-left" onClick={() => onOpen(s.id)}>
                        <AssetImage
                          assetId={s.id}
                          alt={assetTypeLabel(s.type)}
                          className="aspect-square w-full rounded"
                        />
                        <span className="muted text-[10px]">相似度 {Math.round(s.score * 100)}%</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}
          {q.data.variants.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-medium">派生文件</h3>
              <table className="w-full text-xs">
                <tbody>
                  {q.data.variants.map((v) => (
                    <tr key={v.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="p-1.5 font-medium">{v.variant}</td>
                      <td className="p-1.5">
                        {v.width}×{v.height}
                      </td>
                      <td className="p-1.5">{fmt.bytes(v.byteSize)}</td>
                      <td className="muted p-1.5 font-mono">{JSON.stringify(v.params)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(q.data.lineage.length > 0 || q.data.children.length > 0) && (
            <div className="text-sm">
              <h3 className="mb-1 font-medium">派生关系</h3>
              <div className="flex flex-wrap items-center gap-1 text-xs">
                {[...q.data.lineage].reverse().map((l) => (
                  <span key={l.id} className="chip bg-[var(--panel-2)]">
                    {l.id.slice(0, 8)} →
                  </span>
                ))}
                <span className="chip bg-accent-600/20">当前素材</span>
                {q.data.children.map((c) => (
                  <span key={c.id} className="chip bg-[var(--panel-2)]">
                    → {c.id.slice(0, 8)}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <h3 className="mb-1 text-sm font-medium">元数据</h3>
            <JsonBlock value={a.metadata} maxHeight="14rem" />
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        title="永久删除？"
        danger
        confirmLabel="删除"
        busy={remove.isPending}
        onClose={() => setConfirm(false)}
        onConfirm={() => remove.mutate()}
      >
        将从存储中删除原始文件及所有派生文件，此操作无法撤销。
      </ConfirmDialog>
    </Modal>
  );
}

/** Where a file comes from and on what terms (an upload's licence), shown in provenance records. */
function LicenceField({
  value,
  onSave,
}: {
  value: { text: string; url?: string } | null;
  onSave: (v: { text: string; url?: string } | null) => void;
}) {
  const [text, setText] = useState(value?.text ?? "");
  const [url, setUrl] = useState(value?.url ?? "");
  const changed = text !== (value?.text ?? "") || url !== (value?.url ?? "");
  return (
    <Field label="许可与来源" hint="将写入来源记录，例如“CC BY 4.0，摄影者……” 。">
      <div className="flex flex-wrap gap-1">
        <input
          className="input min-w-0 flex-1"
          aria-label="许可说明"
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <input
          className="input min-w-0 flex-1"
          aria-label="许可链接"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          type="button"
          className="btn-secondary"
          disabled={!changed}
          onClick={() => onSave(text.trim() ? { text: text.trim(), ...(url.trim() ? { url: url.trim() } : {}) } : null)}
        >
          保存
        </button>
      </div>
    </Field>
  );
}
