import { providerCatalog } from "@openmanga/domain/browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { get, post } from "../../../api/client.ts";
import { qk, useAction } from "../../../api/hooks.ts";
import { AssetImage, fmt, StatusChip } from "../../../components/ui.tsx";
import { useAiChoices, useAiOptions } from "../../ai/AiPicker.tsx";

type Run = {
  jobId: string;
  status: string;
  provider: string | null;
  model: string | null;
  credentialId: string | null;
  failureReason: string | null;
  assetId: string | null;
  durationMs: number | null;
  costUsd: number;
  check: { status: string; verdict?: string; problems?: string[] } | null;
};
type Row = { credentialId: string | null; model: string };

/**
 * Model comparison: the panel drawn by 2-4 image models at once, side by side with time, cost and the visual check;
 * the picked one becomes the panel's artwork and the image model for what you draw next.
 */
export function CompareModels({
  panelId,
  locked,
  invalidate,
}: {
  panelId: string;
  locked: boolean;
  invalidate: readonly (readonly unknown[])[];
}) {
  const qc = useQueryClient();
  const opts = useAiOptions();
  const setChoice = useAiChoices((s) => s.set);
  const creds = (opts.data?.credentials ?? []).filter((c) => {
    const p = providerCatalog(c.kind);
    return p && (p.kind === "openai_compatible" || p.imageModels.length > 0);
  });
  const modelsOf = (credentialId: string | null) => {
    const c = creds.find((x) => x.id === credentialId);
    if (!c) return opts.data?.defaults.image ? [opts.data.defaults.image.model] : [];
    return providerCatalog(c.kind)?.imageModels ?? [];
  };
  const first = creds[0]?.id ?? null;
  const [rows, setRows] = useState<Row[]>(() => [
    { credentialId: first, model: "" },
    { credentialId: creds[1]?.id ?? first, model: "" },
  ]);
  const key = [...qk.panel(panelId), "compare"];
  const q = useQuery({
    queryKey: key,
    queryFn: () => get<{ compareId: string | null; runs: Run[] }>(`/panels/${panelId}/compare`),
    refetchInterval: (r) =>
      r.state.data?.runs.some(
        (x) =>
          !["completed", "failed", "cancelled"].includes(x.status) ||
          (x.check && x.check.status !== "completed" && x.check.status !== "failed"),
      )
        ? 3000
        : false,
  });
  const run = useAction(
    () =>
      post(`/panels/${panelId}/compare`, {
        runs: rows.map((r) => ({
          credentialId: r.credentialId,
          model: r.model || modelsOf(r.credentialId)[0] || null,
        })),
      }),
    { invalidate: [key], success: "正在使用各模型生成" },
  );
  const pick = useAction(
    (jobId: string) =>
      post<{ credentialId: string | null; model: string | null }>(`/panels/${panelId}/compare/pick`, { jobId }),
    {
      success: "已使用此结果，并将其设为当前图片模型",
      onSuccess: (r) => {
        setChoice("image", { credentialId: r.credentialId, model: r.model ?? "" });
        for (const k of invalidate) void qc.invalidateQueries({ queryKey: k });
      },
    },
  );
  const label = (r: { credentialId: string | null }) =>
    creds.find((c) => c.id === r.credentialId)?.label ?? "服务器默认";
  return (
    <details className="rounded-lg border border-[var(--border)] p-2">
      <summary className="cursor-pointer text-sm font-medium">比较模型</summary>
      <div className="mt-2 space-y-2 text-xs">
        <p className="muted">
          使用多个图片模型同时生成本分镜，再选择最佳结果。每次生成消耗对应密钥的额度，选择结果后才会替换当前分镜图片。
        </p>
        {rows.map((r, i) => (
          <div key={i} className="flex gap-1">
            <select
              className="input py-1 text-xs"
              aria-label={`模型 ${i + 1} 的密钥`}
              value={r.credentialId ?? ""}
              onChange={(e) =>
                setRows((rs) => rs.map((x, k) => (k === i ? { credentialId: e.target.value || null, model: "" } : x)))
              }
            >
              {opts.data?.defaults.image && <option value="">服务器默认</option>}
              {creds.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              className="input py-1 text-xs"
              aria-label={`模型 ${i + 1} 的名称`}
              list={`models-${panelId}-${i}`}
              placeholder={modelsOf(r.credentialId)[0] ?? "模型"}
              value={r.model}
              onChange={(e) => setRows((rs) => rs.map((x, k) => (k === i ? { ...x, model: e.target.value } : x)))}
            />
            <datalist id={`models-${panelId}-${i}`}>
              {modelsOf(r.credentialId).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            {rows.length > 2 && (
              <button
                type="button"
                className="btn-ghost p-1"
                aria-label={`移除模型 ${i + 1}`}
                onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        ))}
        <div className="flex gap-1">
          {rows.length < 4 && (
            <button
              type="button"
              className="btn-ghost px-2 py-1 text-xs"
              onClick={() => setRows((rs) => [...rs, { credentialId: first, model: "" }])}
            >
              <Plus className="size-3.5" /> 模型
            </button>
          )}
          <button
            type="button"
            className="btn-primary ml-auto px-2 py-1 text-xs"
            disabled={locked || run.isPending}
            onClick={() => run.mutate()}
          >
            使用 {rows.length} 个模型生成
          </button>
        </div>
        {Boolean(q.data?.runs.length) && (
          <ul className="grid grid-cols-2 gap-2" aria-label="比较结果">
            {q.data!.runs.map((r) => (
              <li key={r.jobId} className="space-y-1 rounded-md border border-[var(--border)] p-1">
                {r.assetId ? (
                  <AssetImage
                    assetId={r.assetId}
                    alt={`${r.model} 的结果`}
                    className="aspect-square w-full rounded"
                    fit="contain"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center rounded bg-[var(--panel-2)]">
                    <StatusChip status={r.status} />
                  </div>
                )}
                <div className="truncate font-medium" title={`${r.provider} · ${r.model}`}>
                  {label(r)} · {r.model}
                </div>
                <div className="muted">
                  {r.durationMs !== null ? `${(r.durationMs / 1000).toFixed(1)} 秒` : "…"} · {fmt.usd(r.costUsd)}
                </div>
                {r.check?.verdict && (
                  <div className={r.check.verdict === "ok" ? "text-emerald-600" : "text-amber-600"}>
                    检查结果 {r.check.verdict}
                    {r.check.problems?.length ? ` (${r.check.problems.length})` : ""}
                  </div>
                )}
                {r.failureReason && <div className="text-red-500">{r.failureReason}</div>}
                <button
                  type="button"
                  className="btn-secondary w-full px-2 py-1 text-xs"
                  disabled={!r.assetId || locked || pick.isPending}
                  onClick={() => pick.mutate(r.jobId)}
                >
                  使用此结果
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
