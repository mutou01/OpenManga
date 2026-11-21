import { useQueryClient } from "@tanstack/react-query";
import { ScanEye } from "lucide-react";
import { useState } from "react";
import { post } from "../../api/client.ts";
import { ConfirmDialog, fmt, Spinner, toast } from "../../components/ui.tsx";
import { AiChip, useAiBody } from "../ai/AiPicker.tsx";

type Scope = { pageId?: string; chapterId?: string };
type Estimate = {
  count: number;
  total: number;
  skippedReasons: { noArtwork: number; inProgress: number; alreadyChecked: number };
  estimatedUsd: number | null;
  provider: { provider: string; model: string };
};

/**
 * Check all panels: the vision consistency check for a page, chapter or project in one run, priced first. The
 * results feed the drift flags and "Move bubbles off faces".
 */
export function CheckPanelsButton({
  projectId,
  scope,
  label = "检查全部画格",
  className = "btn-secondary",
}: {
  projectId: string;
  scope: Scope;
  label?: string;
  className?: string;
}) {
  const qc = useQueryClient();
  const aiText = useAiBody("text");
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [onlyUnchecked, setOnlyUnchecked] = useState(true);
  const [busy, setBusy] = useState(false);
  const call = async (confirm: boolean, only = onlyUnchecked) => {
    setBusy(true);
    try {
      const r = await post<Estimate & { jobs?: unknown[] }>(`/projects/${projectId}/checks`, {
        ...aiText(),
        scope,
        onlyUnchecked: only,
        confirm,
      });
      if (!confirm) setEstimate(r);
      else {
        setEstimate(null);
        toast.success(r.jobs?.length ? `${r.jobs.length} 项检查已加入队列` : "暂无需要检查的画格");
        await qc.invalidateQueries({ queryKey: ["project", projectId, "generations"] });
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const skipped = estimate
    ? [
        estimate.skippedReasons.alreadyChecked && `${estimate.skippedReasons.alreadyChecked} 个已有检查结果`,
        estimate.skippedReasons.inProgress && `${estimate.skippedReasons.inProgress} 个正在检查`,
        estimate.skippedReasons.noArtwork && `${estimate.skippedReasons.noArtwork} 个缺少原画`,
      ]
        .filter(Boolean)
        .join(", ")
    : "";
  return (
    <>
      <AiChip cap="text" />
      <button type="button" className={className} disabled={busy} onClick={() => call(false)}>
        {busy ? <Spinner /> : <ScanEye className="size-4" />} {label}
      </button>
      <ConfirmDialog
        open={Boolean(estimate)}
        title={label}
        confirmLabel={estimate?.count ? `检查 ${estimate.count} 个画格` : "暂无需要检查的画格"}
        disabled={!estimate?.count}
        busy={busy}
        onClose={() => setEstimate(null)}
        onConfirm={() => call(true)}
      >
        {estimate && (
          <div className="space-y-3 text-sm">
            <p>
              视觉模型将检查 <strong>{estimate.count}</strong> 个画格，确认预期角色是否出现，并定位人脸。
              {skipped && <span className="muted"> 已跳过 {skipped}。</span>}
            </p>
            <p>
              预计费用{" "}
              <strong>
                {estimate.estimatedUsd === null ? "未知（暂无费率快照）" : `≈ ${fmt.usd(estimate.estimatedUsd)}`}
              </strong>
              <span className="muted">
                {" "}
                · {estimate.provider.provider} · {estimate.provider.model}
              </span>
            </p>
            <p className="muted text-xs">
              优先使用“项目设置 → 一致性检查”中的密钥，否则使用上方所选的文本模型，该模型需要支持图片输入。
            </p>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={onlyUnchecked}
                onChange={(e) => {
                  setOnlyUnchecked(e.target.checked);
                  void call(false, e.target.checked);
                }}
              />
              仅检查没有当前检查结果的画格
            </label>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
