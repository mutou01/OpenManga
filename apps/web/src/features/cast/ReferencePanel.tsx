import { Link } from "@tanstack/react-router";
import { ExternalLink, ImagePlus, Lock, Sparkles, Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, assetUrl, del, errorMessage, post } from "../../api/client.ts";
import { onProjectEvent, useAction } from "../../api/hooks.ts";
import type { CharacterOutfitRow, Reference } from "../../api/types.ts";
import { AssetImage, ConfirmDialog, EmptyState, fmt, Modal, Spinner, StatusChip, toast } from "../../components/ui.tsx";
import { AiChip, useAiBody } from "../ai/AiPicker.tsx";
import { useProjectId } from "../project/ProjectLayout.tsx";

export type Subject = "character" | "location" | "prop" | "style";

const KINDS: Record<Subject, string[]> = {
  // full_body first: it is the default kind, and the one panels lean on most (height, proportions, clothing).
  character: ["full_body", "portrait", "multi_angle", "expression_sheet", "outfit"],
  // Each is one image; the primary (starred) one is what panels are drawn from.
  location: ["location", "location_panorama", "location_sheet"],
  prop: ["prop", "prop_multi_angle"],
  style: ["style"],
};

const KIND_LABELS: Record<string, string> = {
  location: "广角视图",
  location_panorama: "panorama",
  location_sheet: "各侧面设定图",
  prop: "单视图",
  prop_multi_angle: "多角度视图",
};
const kindLabel = (k: string) => KIND_LABELS[k] ?? k.replace(/_/g, " ");

type Pending = { jobId: string; status: string; failureReason?: string | null };

export function ReferencePanel({
  subject,
  versionPath,
  versionId,
  versionStatus,
  references,
  outfits,
  stateNames,
  onChanged,
  trashed,
}: {
  subject: Subject;
  versionPath: string;
  versionId: string;
  versionStatus: string;
  references: Reference[];
  outfits?: CharacterOutfitRow[];
  /** Locations: the place's states by id, to label a state's reference. */
  stateNames?: Map<string, string>;
  onChanged: () => void;
  /** The subject is in the trash, and these images with it: shown dimmed until it is restored. */
  trashed?: boolean;
}) {
  const projectId = useProjectId();
  const kinds = KINDS[subject];
  const [kind, setKind] = useState(kinds[0]!);
  const [outfitId, setOutfitId] = useState("");
  /** Outfits that already have a reference, so the dropdown says which are still to do. */
  const outfitsWithReference = new Set(
    (references ?? []).map((r) => r.outfitId).filter((x): x is string => Boolean(x)),
  );
  /** An outfit reference is drawn from the approved design, so that has to exist before any outfit can be run. */
  const hasApprovedIdentity = (references ?? []).some(
    (r) => !r.outfitId && (r.status === "approved" || r.status === "locked"),
  );
  const needsBaseline = subject === "character" && kind === "outfit" && !hasApprovedIdentity;
  const [extra, setExtra] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [viewing, setViewing] = useState<Reference | null>(null);
  const [trashing, setTrashing] = useState<Reference | null>(null);
  const [uploading, setUploading] = useState(false);
  const mine = references.filter(
    (r) => (r.characterVersionId ?? r.locationVersionId ?? r.propVersionId ?? r.projectStyleId) === versionId,
  );
  const superseded = versionStatus === "superseded";

  useEffect(() => {
    const off = onProjectEvent((e) => {
      if (e.type !== "job.updated" || e.targetId !== versionId || !String(e.kind).endsWith("_reference")) return;
      const jobId = String(e.jobId);
      setPending((list) => {
        const others = list.filter((p) => p.jobId !== jobId);
        if (e.status === "completed" || e.status === "cancelled") return others;
        return [...others, { jobId, status: String(e.status), failureReason: e.failureReason as string | null }];
      });
      if (e.status === "completed") onChanged();
    });
    return () => {
      off();
    };
  }, [versionId, onChanged]);

  const aiImage = useAiBody("image");
  const generate = useAction(
    () =>
      post<{ job: { id: string } }>(`/${versionPath}/${versionId}/references/generate`, {
        ...aiImage(),
        kind,
        extraInstruction: extra.trim() || undefined,
        outfitId: kind === "outfit" && outfitId ? outfitId : undefined,
      }),
    {
      onSuccess: (r) => setPending((p) => [...p, { jobId: r.job.id, status: "queued" }]),
      success: "参考图生成已加入队列",
    },
  );
  const setStatus = useAction(
    ({ id, status }: { id: string; status: string }) => post(`/references/${id}/status`, { status }),
    { onSuccess: onChanged },
  );
  const primary = useAction((id: string) => post(`/references/${id}/primary`), { onSuccess: onChanged });
  const trash = useAction((id: string) => del(`/references/${id}`), {
    onSuccess: () => {
      setTrashing(null);
      onChanged();
    },
    success: "参考图已移入回收站",
  });

  const upload = async (file: File) => {
    const form = new FormData();
    form.set("file", file);
    form.set("kind", kinds.length > 1 ? kind : "uploaded");
    setUploading(true);
    try {
      await api(`/${versionPath}/${versionId}/references/upload`, { method: "POST", body: form });
      toast.success("参考图已上传");
      onChanged();
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className={trashed ? "card p-4 opacity-60" : "card p-4"} aria-label="参考图">
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <h2 className="mr-auto font-semibold">标准参考图</h2>
        {kinds.length > 1 && (
          <label>
            <span className="label">类型</span>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "outfit" && outfits && (
          <label>
            <span className="label">服装</span>
            <select className="input" value={outfitId} onChange={(e) => setOutfitId(e.target.value)}>
              <option value="">默认服装</option>
              {outfits.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {outfitsWithReference.has(o.id) ? " ✓" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="min-w-48 flex-1">
          <span className="label">补充说明（可选）</span>
          <input
            className="input"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="例如，面带微笑"
          />
        </label>
        <AiChip cap="image" />
        <button
          type="button"
          className="btn-primary"
          disabled={superseded || generate.isPending || needsBaseline}
          title={needsBaseline ? "请先生成并审核主参考图，服装将以此绘制以保持面容一致" : undefined}
          onClick={() => generate.mutate()}
        >
          {generate.isPending ? <Spinner /> : <Sparkles className="size-4" />} 生成
        </button>
        <label
          className={`btn-secondary cursor-pointer ${superseded || uploading ? "pointer-events-none opacity-50" : ""}`}
        >
          {uploading ? <Spinner /> : <ImagePlus className="size-4" />} 上传
          <input
            type="file"
            className="sr-only"
            accept="image/png,image/jpeg,image/webp"
            disabled={superseded || uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <p className="muted mb-3 text-xs">
        参考图以原始分辨率生成并保存，作为标准身份依据。审核通过后会创建小尺寸派生图，附加到后续画格生成请求中。
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {pending.map((p) => (
          <div
            key={p.jobId}
            className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] p-3 text-center text-sm"
          >
            {p.status === "failed" ? (
              <>
                <span className="text-red-500">生成失败</span>
                <span className="muted text-xs">{p.failureReason}</span>
                <div className="flex gap-1">
                  <Link
                    to="/projects/$projectId/generation/$jobId"
                    params={{ projectId, jobId: p.jobId }}
                    className="btn-ghost text-xs"
                  >
                    查看详情
                  </Link>
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => setPending((l) => l.filter((x) => x.jobId !== p.jobId))}
                  >
                    关闭
                  </button>
                </div>
              </>
            ) : (
              <>
                <Spinner className="size-6" />
                <span>正在生成原始分辨率参考图……</span>
                <StatusChip status={p.status} />
              </>
            )}
          </div>
        ))}
        {mine.map((r) => {
          const d = r.promptDerivatives[0];
          const active = r.status === "approved" || r.status === "locked";
          return (
            <div key={r.id} className="overflow-hidden rounded-lg border border-[var(--border)]">
              <button type="button" className="block w-full" onClick={() => setViewing(r)} aria-label="查看原始分辨率">
                <AssetImage
                  assetId={r.asset.id}
                  alt={`${kindLabel(r.kind)}参考图`}
                  className="aspect-[3/4] w-full"
                  fit="contain"
                  trashed={trashed}
                />
              </button>
              <div className="space-y-1.5 p-2 text-xs">
                <div className="flex items-center gap-1">
                  <span className="font-medium capitalize">{kindLabel(r.kind)}</span>
                  {r.locationStateId && (
                    <span className="chip text-[10px]">{stateNames?.get(r.locationStateId) ?? "状态"}</span>
                  )}
                  {r.isPrimary && <Star className="size-3.5 fill-amber-400 text-amber-400" aria-label="主参考图" />}
                  <span className="ml-auto flex items-center gap-1">
                    {r.stale && (
                      <span
                        className="chip bg-amber-500/15 text-amber-600"
                        title="基于旧版描述生成，仍展示旧外观并会附加到每个画格，请重新生成。"
                      >
                        已过时
                      </span>
                    )}
                    <StatusChip status={r.status} />
                  </span>
                </div>
                <div className="muted">
                  {r.asset.width}×{r.asset.height} 原始参考图 · {fmt.bytes(r.asset.byteSize)}
                </div>
                <div className="muted">
                  {d ? `提示词参考图 ${d.width}×${d.height} · ${fmt.bytes(d.byteSize)}` : "审核通过后创建派生图"}
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {r.status === "draft" && (
                    <button
                      type="button"
                      className="btn-secondary px-2 py-1 text-xs"
                      onClick={() => setStatus.mutate({ id: r.id, status: "approved" })}
                    >
                      审核通过
                    </button>
                  )}
                  {r.status === "approved" && (
                    <>
                      <button
                        type="button"
                        className="btn-secondary px-2 py-1 text-xs"
                        onClick={() => setStatus.mutate({ id: r.id, status: "locked" })}
                      >
                        <Lock className="size-3" /> 锁定
                      </button>
                      <button
                        type="button"
                        className="btn-ghost px-2 py-1 text-xs"
                        onClick={() => setStatus.mutate({ id: r.id, status: "draft" })}
                      >
                        撤销审核
                      </button>
                    </>
                  )}
                  {!r.isPrimary && active && (
                    <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => primary.mutate(r.id)}>
                      <Star className="size-3" /> 主参考图
                    </button>
                  )}
                  {r.asset.generationJobId && (
                    <Link
                      to="/projects/$projectId/generation/$jobId"
                      params={{ projectId, jobId: r.asset.generationJobId }}
                      className="btn-ghost px-2 py-1 text-xs"
                      title="提示词检查器"
                    >
                      <ExternalLink className="size-3" />
                    </Link>
                  )}
                  {r.status !== "locked" && (
                    <button
                      type="button"
                      className="btn-ghost ml-auto px-2 py-1 text-xs text-red-500"
                      onClick={() => setTrashing(r)}
                      aria-label="将参考图移入回收站"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {!mine.length && !pending.length && (
        <EmptyState title="暂无参考图">使用图像 AI 生成原始分辨率参考图，或上传自己的图片。</EmptyState>
      )}

      <Modal
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title={viewing ? `${kindLabel(viewing.kind)} — ${viewing.asset.width}×${viewing.asset.height}` : ""}
        wide="xl"
      >
        {viewing && (
          <img
            src={assetUrl(viewing.asset.id, undefined, undefined, trashed)}
            alt="原始分辨率参考图"
            className="mx-auto max-h-[65vh] object-contain"
          />
        )}
      </Modal>
      <ConfirmDialog
        open={Boolean(trashing)}
        title="将参考图移入回收站？"
        danger
        confirmLabel="移入回收站"
        busy={trash.isPending}
        onClose={() => setTrashing(null)}
        onConfirm={() => trashing && trash.mutate(trashing.id)}
      >
        图片将移入素材回收站，并停止用作身份参考图。
      </ConfirmDialog>
      {setStatus.error && <p className="mt-2 text-xs text-red-500">{errorMessage(setStatus.error)}</p>}
    </section>
  );
}
