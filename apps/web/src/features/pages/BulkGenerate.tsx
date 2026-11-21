import { framePolygon } from "@openmanga/domain/browser";
import type { Frame } from "@openmanga/schemas";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { post } from "../../api/client.ts";
import { ConfirmDialog, fmt, Spinner, toast } from "../../components/ui.tsx";
import { AiChip, useAiBody } from "../ai/AiPicker.tsx";
import { useInvalidateBatches } from "../generation/BatchStatus.tsx";

type Scope = {
  pageId?: string;
  sceneId?: string;
  chapterId?: string;
  panelIds?: string[];
  /** Every location or every prop: one reference each. */
  references?: "character" | "location" | "prop";
  referenceKind?: string;
};

/** What the run makes, in the words the dialog uses. */
type Noun = { one: string; many: string; missing: string };
const PANELS: Noun = { one: "个分镜", many: "个分镜", missing: "仅生成无图片的分镜" };
type Estimate = {
  confirmRequired?: boolean;
  count: number;
  skipped: number;
  total?: number;
  skippedReasons?: {
    inProgress: number;
    hasArtwork?: number;
    locked?: number;
    hasReference?: number;
    minor?: number;
  };
  estimatedUsd: number | null;
  budget?: {
    limitUsd: number | null;
    spentUsd: number;
    remainingUsd: number | null;
    exceeded: boolean;
    unpricedCalls: number;
  };
  provider?: { provider: string; model: string };
  /** Which mode this price was calculated for; the dialog will not show it against the other one. */
  batch?: boolean;
  preflight?: Preflight;
  credentials?: { text: boolean; image: boolean; mockMode: boolean };
  /** Reference runs: how many of the locations/props already have each kind of reference. */
  existing?: Record<string, number>;
};

type Preflight = {
  panels: number;
  harmVocabulary: { panels: number; terms: { term: string; panels: number }[] };
  characterWarnings: { characterId: string; name: string; versionNumber: number; panels: number; terms: string[] }[];
  distress: { panels: number };
  staleReferences: { name: string; versionNumber: number; panels: number }[];
  missingReferences: { name: string; versionNumber: number; panels: number }[];
};

/** What is likely to be blocked or lose identity, found before spending. Informational; nothing is prevented. */
export function PreflightNotes({ preflight: f }: { preflight: Preflight }) {
  const notes: string[] = [];
  for (const c of f.characterWarnings)
    notes.push(
      `${c.name} v${c.versionNumber}（用于 ${c.panels} 个分镜）的描述包含 ${c.terms.map((t) => `“${t}”`).join("、")}`,
    );
  const panelTerms = f.harmVocabulary.terms.filter((t) => !f.characterWarnings.some((c) => c.terms.includes(t.term)));
  if (panelTerms.length)
    notes.push(`分镜文本包含 ${panelTerms.map((t) => `“${t.term}”（${t.panels} 个分镜）`).join("、")}`);
  if (f.distress.panels)
    notes.push(`${f.distress.panels} 个分镜同时包含孤立人物、昏暗光照，以及痛苦情绪或俯视、倾斜机位`);
  for (const r of f.staleReferences)
    notes.push(`${r.name} v${r.versionNumber} 的已审核参考图基于旧版描述生成（${r.panels} 个分镜）`);
  for (const r of f.missingReferences)
    notes.push(`${r.name} v${r.versionNumber} 没有已审核参考图，人物身份尚未固定（${r.panels} 个分镜）`);
  if (!notes.length) return null;
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
      <p className="mb-1 font-medium text-amber-700 dark:text-amber-300">可能被拦截或出现一致性偏差</p>
      <ul className="list-disc space-y-0.5 pl-4">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <p className="muted mt-1">
        图片内容过滤器（尤其是 Meta
        Muse）有时会拦截这些组合，即使场景本身无害。可先修改措辞或重新生成参考图，也可继续生成。
      </p>
    </div>
  );
}

function skippedText(e: Estimate) {
  const r = e.skippedReasons;
  if (!r) return e.skipped ? `跳过 ${e.skipped} 个` : "";
  return [
    r.inProgress && `${r.inProgress} 个已排队或正在生成`,
    r.hasArtwork && `${r.hasArtwork} 个已有图片`,
    r.hasReference && `${r.hasReference} 个已有参考图`,
    r.minor && `${r.minor} 个为次要或仅出现一次的对象（仅主要对象生成参考图）`,
    r.locked && `${r.locked} 个已锁定`,
  ]
    .filter(Boolean)
    .join("，");
}

/** Bulk generation with count/cost confirmation. Progress is shown by the shared, server-backed batch status. */
export function BulkGenerateButton({
  projectId,
  scope,
  label,
  className,
  noun = PANELS,
  kinds,
}: {
  projectId: string;
  scope: Scope;
  label: string;
  className?: string;
  noun?: Noun;
  /** Reference runs: the kinds that can be drawn, first is the default. */
  kinds?: { value: string; label: string }[];
}) {
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [kind, setKind] = useState(kinds?.[0]?.value);
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [batch, setBatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const invalidateBatches = useInvalidateBatches(projectId);
  const aiImage = useAiBody("image");

  // Both toggles pass their new value in: state set in the same handler is not visible to this closure yet, so
  // reading `batch` here priced the run against the previous setting and left the estimate a click behind.
  const ask = async (missing = onlyMissing, asBatch = batch, refKind = kind) => {
    setBusy(true);
    try {
      setEstimate(
        await post<Estimate>(`/projects/${projectId}/generations/bulk`, {
          ...aiImage(),
          scope: refKind ? { ...scope, referenceKind: refKind } : scope,
          onlyMissing: missing,
          batch: asBatch,
        }),
      );
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    setBusy(true);
    try {
      const r = await post<{ batchId: string | null; jobs: unknown[]; failures?: { error: string }[] }>(
        `/projects/${projectId}/generations/bulk`,
        { ...aiImage(), scope: kind ? { ...scope, referenceKind: kind } : scope, onlyMissing, confirm: true, batch },
      );
      setEstimate(null);
      if (!r.batchId) toast.info("暂无可生成内容");
      else {
        await invalidateBatches();
        toast.success(
          batch
            ? `已将 ${r.jobs.length} ${r.jobs.length === 1 ? noun.one : noun.many}发送到提供商批处理，预计 24 小时内返回结果`
            : `已将 ${r.jobs.length} ${r.jobs.length === 1 ? noun.one : noun.many}加入队列`,
        );
      }
      if (r.failures?.length) toast.error(`${r.failures.length} ${noun.many}加入队列失败，${r.failures[0]!.error}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const nothing = estimate !== null && estimate.count === 0;
  return (
    <>
      <AiChip cap="image" />
      <button type="button" className={className ?? "btn-primary"} disabled={busy} onClick={() => ask()}>
        {busy ? <Spinner /> : <Sparkles className="size-4" />} {label}
      </button>
      <ConfirmDialog
        open={Boolean(estimate)}
        title={label}
        confirmLabel={nothing ? "暂无可排队任务" : `生成 ${estimate?.count ?? 0} 个`}
        busy={busy}
        disabled={nothing}
        onClose={() => setEstimate(null)}
        onConfirm={confirm}
      >
        {estimate && (
          <div className="space-y-3">
            {kinds && (
              <div className="space-y-1 rounded-md bg-[var(--panel-2)] p-2 text-sm">
                <label className="flex items-center gap-2">
                  <span className="shrink-0">生成范围</span>
                  <select
                    className="input"
                    value={kind}
                    disabled={busy}
                    onChange={(e) => {
                      setKind(e.target.value);
                      void ask(onlyMissing, batch, e.target.value);
                    }}
                  >
                    {kinds.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </label>
                {estimate.existing && (
                  <p className="muted text-xs">
                    已有参考图 {kinds.map((k) => `${estimate.existing?.[k.value] ?? 0} 个已有${k.label}`).join(", ")}
                    {estimate.total != null ? `（共 ${estimate.total} 个）` : ""}.
                  </p>
                )}
              </div>
            )}
            {nothing ? (
              <p>
                <strong>暂无可生成内容。</strong> 全部 {estimate.total ?? estimate.skipped} {noun.many} 已跳过
                {skippedText(estimate) ? `：${skippedText(estimate)}` : ""}。
                {estimate.skippedReasons?.inProgress ? " 进度显示在当前界面及窗口底部的批次状态中。" : ""}
              </p>
            ) : (
              <>
                <p>
                  将加入队列 <strong>{estimate.count}</strong> 次独立图片生成
                  {skippedText(estimate) ? `（已跳过 ${skippedText(estimate)}）` : ""}.
                </p>
                <p>
                  预计费用{" "}
                  <strong>
                    {/* The response says which mode it priced, so a price is never shown against the other one. */}
                    {estimate.batch !== batch
                      ? "正在重新估价…"
                      : estimate.estimatedUsd === null
                        ? "未知（缺少计费记录）"
                        : `≈ ${fmt.usd(estimate.estimatedUsd)}`}
                  </strong>
                  <span className="muted"> （仅为估算，实际提供商用量按任务记录。）</span>
                </p>
                {estimate.credentials && !estimate.credentials.image && !estimate.credentials.mockMode && (
                  <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                    尚未保存支持图片生成的 API 密钥。服务器没有共享密钥，请先到“账户 → AI 提供商”添加，否则任务会失败。
                  </p>
                )}
                <label className="flex items-start gap-2 rounded-md bg-[var(--panel-2)] p-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={batch}
                    disabled={busy}
                    onChange={(e) => {
                      setBatch(e.target.checked);
                      // Re-price immediately: the batch rate is half, and some providers cannot batch at all.
                      // The old estimate stays on screen while that runs — clearing it closed the whole dialog,
                      // and a re-price that fails (a provider with no batch API) left nothing but a toast.
                      void ask(onlyMissing, e.target.checked);
                    }}
                  />
                  <span>
                    <strong>发送为提供商批处理</strong> ，费用减半，通常在 24 小时内返回结果。
                    <span className="muted">
                      {" "}
                      {noun.many[0]!.toUpperCase() + noun.many.slice(1)} 将在提供商侧等待处理，仅支持 OpenAI 和 Google
                      密钥。
                    </span>
                  </span>
                </label>
                {estimate.preflight && <PreflightNotes preflight={estimate.preflight} />}
                {estimate.provider && (
                  <p className="muted text-xs">
                    使用 {estimate.provider.provider} · {estimate.provider.model}
                  </p>
                )}
                {estimate.budget?.limitUsd != null && (
                  <p
                    className={
                      estimate.budget.spentUsd + (estimate.estimatedUsd ?? 0) >= estimate.budget.limitUsd
                        ? "rounded-md bg-amber-500/15 p-2 text-sm text-amber-700 dark:text-amber-300"
                        : "muted text-sm"
                    }
                  >
                    项目预算 {fmt.usd(estimate.budget.spentUsd)} / {fmt.usd(estimate.budget.limitUsd)} 已使用
                    {estimate.budget.spentUsd + (estimate.estimatedUsd ?? 0) >= estimate.budget.limitUsd
                      ? "。本批次将超出预算，继续前需要确认。"
                      : `，剩余 ${fmt.usd(estimate.budget.remainingUsd ?? 0)}。`}
                  </p>
                )}
                {!!estimate.budget?.unpricedCalls && (
                  <p className="muted text-sm">
                    {estimate.budget.unpricedCalls} 次历史调用
                    {estimate.budget.unpricedCalls === 1 ? "" : "s"}{" "}
                    无法计价（缺少对应模型的费率快照），因此当前费用统计偏低。
                  </p>
                )}
              </>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={onlyMissing}
                onChange={(e) => {
                  setOnlyMissing(e.target.checked);
                  void ask(e.target.checked);
                }}
              />
              {noun.missing}
            </label>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}

export function LayoutThumb({ frames, className }: { frames: Frame[]; className?: string }) {
  return (
    <svg viewBox="0 0 100 150" className={className ?? "h-12 w-8"} aria-hidden="true">
      <rect width="100" height="150" fill="currentColor" opacity="0.08" />
      {frames.map((f, i) =>
        f.points ? (
          // A shaped panel: its outline.
          <polygon
            key={i}
            points={framePolygon(f)
              .map((p) => `${(p.x * 100).toFixed(1)},${(p.y * 150).toFixed(1)}`)
              .join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />
        ) : (
          <rect
            key={i}
            x={f.x * 100 + 2}
            y={f.y * 150 + 2}
            width={Math.max(1, f.width * 100 - 4)}
            height={Math.max(1, f.height * 150 - 4)}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />
        ),
      )}
    </svg>
  );
}
