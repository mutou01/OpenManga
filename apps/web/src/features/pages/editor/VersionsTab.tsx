import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Columns2, ImagePlus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, assetUrl, del, get, post } from "../../../api/client.ts";
import { qk, useAction } from "../../../api/hooks.ts";
import type { ArtworkVersion, EditorPanel } from "../../../api/types.ts";
import { AssetImage, clsx, EmptyState, ErrorBox, fmt, Modal, Spinner, toast } from "../../../components/ui.tsx";
import { useProjectId } from "../../project/ProjectLayout.tsx";

export function VersionsTab({ panel, pageId }: { panel: EditorPanel; pageId: string }) {
  const projectId = useProjectId();
  const q = useQuery({
    queryKey: [...qk.panel(panel.id), "versions"],
    queryFn: () => get<{ activeAssetId: string | null; versions: ArtworkVersion[] }>(`/panels/${panel.id}/versions`),
  });
  const [compare, setCompare] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const qc = useQueryClient();
  const inv = [qk.panel(panel.id), qk.page(pageId)];
  const activate = useAction((assetId: string) => post(`/panels/${panel.id}/versions/${assetId}/activate`), {
    invalidate: inv,
    success: "已启用版本",
  });
  const remove = useAction((assetId: string) => del(`/panels/${panel.id}/versions/${assetId}`), {
    invalidate: inv,
    success: "版本已移到回收站",
  });

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      await api(`/panels/${panel.id}/artwork/upload`, { method: "POST", body: form });
      toast.success("已上传图片");
      for (const key of inv) qc.invalidateQueries({ queryKey: key });
      await q.refetch();
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
    }
  };
  // Uploading is how a panel gets artwork without a provider key at all, so it has to be reachable before any
  // version exists — not only alongside a list of generated ones.
  const uploadButton = (
    <label className={clsx("btn-secondary cursor-pointer", uploading && "pointer-events-none opacity-50")}>
      {uploading ? <Spinner /> : <ImagePlus className="size-4" />} 上传图片
      <input
        type="file"
        className="sr-only"
        accept="image/png,image/jpeg,image/webp"
        disabled={uploading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
    </label>
  );

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const versions = q.data?.versions ?? [];
  if (!versions.length)
    return (
      <div className="space-y-3">
        <EmptyState title="暂无图片">生成分镜图片，或上传自己的图片。</EmptyState>
        <div className="flex justify-center">{uploadButton}</div>
      </div>
    );
  const byId = new Map(versions.map((v) => [v.assetId, v]));
  const toggle = (id: string) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c.slice(-1), id]));

  return (
    <div className="space-y-2 text-sm">
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary flex-1"
          disabled={compare.length !== 2}
          onClick={() => setOpen(true)}
        >
          <Columns2 className="size-4" /> 比较所选版本（{compare.length}/2)
        </button>
        {uploadButton}
      </div>
      <ul className="space-y-2">
        {versions.map((v) => {
          const active = q.data?.activeAssetId === v.assetId;
          const parent = v.parentAssetId ? byId.get(v.parentAssetId) : null;
          return (
            <li
              key={v.assetId}
              className={clsx(
                "flex gap-2 rounded-lg border p-2",
                active ? "border-emerald-500" : "border-[var(--border)]",
              )}
            >
              <a href={assetUrl(v.assetId)} target="_blank" rel="noreferrer" className="shrink-0">
                <AssetImage assetId={v.assetId} alt={`版本 ${v.versionNumber}`} className="size-20 rounded" />
              </a>
              <div className="min-w-0 flex-1 text-xs">
                <div className="flex items-center gap-1 font-medium">
                  v{v.versionNumber}{" "}
                  {active && <CheckCircle2 className="size-3.5 text-emerald-500" aria-label="当前使用" />}
                  {v.cancelled && <span className="chip bg-zinc-500/15">已取消</span>}
                </div>
                <div className="muted">
                  {(v.operation ?? v.kind ?? "generation").replace(/_/g, " ")}
                  {parent ? ` · 源自 v${parent.versionNumber}` : ""}
                </div>
                <div className="muted">
                  {v.width}×{v.height} · {fmt.ago(v.createdAt)}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={compare.includes(v.assetId)} onChange={() => toggle(v.assetId)} />{" "}
                    比较
                  </label>
                  {!active && (
                    <button
                      type="button"
                      className="btn-ghost px-1.5 py-0.5 text-xs"
                      onClick={() => activate.mutate(v.assetId)}
                    >
                      启用
                    </button>
                  )}
                  {v.generationJobId && (
                    <Link
                      to="/projects/$projectId/generation/$jobId"
                      params={{ projectId, jobId: v.generationJobId }}
                      className="btn-ghost px-1.5 py-0.5 text-xs"
                    >
                      任务
                    </Link>
                  )}
                  {!active && (
                    <button
                      type="button"
                      className="btn-ghost px-1 py-0.5 text-red-500"
                      aria-label={`删除版本 ${v.versionNumber}`}
                      onClick={() => remove.mutate(v.assetId)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <Modal open={open} onClose={() => setOpen(false)} title="比较版本" wide="xl">
        <div className="grid grid-cols-2 gap-3">
          {compare.map((id) => (
            <figure key={id} className="space-y-1">
              <img
                src={assetUrl(id)}
                alt={`版本 ${byId.get(id)?.versionNumber}`}
                className="w-full rounded-lg bg-[var(--panel-2)] object-contain"
              />
              <figcaption className="flex items-center justify-between text-sm">
                <span>v{byId.get(id)?.versionNumber}</span>
                {q.data?.activeAssetId !== id && (
                  <button type="button" className="btn-secondary py-1" onClick={() => activate.mutate(id)}>
                    启用
                  </button>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      </Modal>
    </div>
  );
}
