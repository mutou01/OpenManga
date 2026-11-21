import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { get, post } from "../../../api/client.ts";
import { qk, useAction } from "../../../api/hooks.ts";
import { AssetImage, clsx, Spinner, StatusChip } from "../../../components/ui.tsx";
import { AiChip, useAiBody } from "../../ai/AiPicker.tsx";
import { editorLabel } from "./labels.ts";

type Sheet = { jobId: string; status: string; failureReason: string | null; assetId: string | null; createdAt: string };

/**
 * Coverage sheet: the panel's moment from nine camera setups in one image. Picked cells reframe this panel or become
 * new panels after it, each drawn later at full size from its cell as a strict layout guide.
 */
export function CoverageSheet({ panelId, pageId, locked }: { panelId: string; pageId: string; locked: boolean }) {
  const qc = useQueryClient();
  const key = [...qk.panel(panelId), "coverage"];
  const q = useQuery({
    queryKey: key,
    queryFn: () => get<{ sheets: Sheet[]; cells: string[] }>(`/panels/${panelId}/coverage`),
    // A sheet being drawn is polled until it lands.
    refetchInterval: (r) =>
      r.state.data?.sheets[0] && !r.state.data.sheets[0].assetId && r.state.data.sheets[0].status !== "failed"
        ? 4000
        : false,
  });
  const aiImage = useAiBody("image");
  const [picked, setPicked] = useState<number[]>([]);
  const draw = useAction(() => post(`/panels/${panelId}/coverage`, aiImage()), {
    invalidate: [key],
    success: "多机位参考图任务已加入队列",
    onSuccess: () => setPicked([]),
  });
  const sheet = q.data?.sheets[0];
  const use = useAction(
    (mode: "this" | "new") =>
      post<{ panelIds: string[] }>(`/coverage-sheets/${sheet!.jobId}/use`, { cells: picked, mode }),
    {
      success: (r) => (r.panelIds.length === 1 ? "已重新构图" : `已在当前分镜后添加 ${r.panelIds.length} 个分镜`),
      onSuccess: () => {
        setPicked([]);
        void qc.invalidateQueries({ queryKey: qk.page(pageId) });
        void qc.invalidateQueries({ queryKey: qk.panel(panelId) });
        void qc.invalidateQueries({ queryKey: ["chapter"] });
      },
    },
  );
  const toggle = (n: number) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n].sort()));
  return (
    <details className="rounded-lg border border-[var(--border)] p-2">
      <summary className="cursor-pointer text-sm font-medium">多机位参考图</summary>
      <div className="mt-2 space-y-2 text-xs">
        <p className="muted">
          用一张图展示同一时刻的九种机位。选择一个画面可为当前分镜重新构图，选择多个可在其后添加新分镜。之后各分镜会依据所选画面生成完整尺寸图片。
        </p>
        <div className="flex items-center gap-2">
          <AiChip cap="image" className="mr-auto" />
          <button
            type="button"
            className="btn-secondary px-2 py-1 text-xs"
            disabled={draw.isPending || locked}
            onClick={() => draw.mutate()}
          >
            {sheet ? "再生成一张" : "生成多机位参考图"}
          </button>
        </div>
        {q.isLoading && <Spinner />}
        {sheet && !sheet.assetId && (
          <div className="flex items-center gap-2">
            <StatusChip status={sheet.status} />
            {sheet.failureReason && <span className="muted">{sheet.failureReason}</span>}
          </div>
        )}
        {sheet?.assetId && (
          <>
            <div className="relative">
              <AssetImage assetId={sheet.assetId} alt="多机位参考图" className="w-full" fit="contain" />
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
                {q.data!.cells.map((label, i) => (
                  <button
                    key={label}
                    type="button"
                    aria-label={`${i + 1}. ${editorLabel(label)}`}
                    aria-pressed={picked.includes(i + 1)}
                    title={label}
                    onClick={() => toggle(i + 1)}
                    className={clsx(
                      "flex items-end justify-start p-1 text-[10px] text-white outline-none",
                      picked.includes(i + 1)
                        ? "bg-accent-500/35 ring-2 ring-accent-500 ring-inset"
                        : "hover:bg-black/15",
                    )}
                  >
                    <span className="rounded bg-black/55 px-1">{label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-xs"
                disabled={picked.length !== 1 || use.isPending || locked}
                onClick={() => use.mutate("this")}
              >
                为当前分镜重新构图
              </button>
              <button
                type="button"
                className="btn-primary px-2 py-1 text-xs"
                disabled={!picked.length || use.isPending}
                onClick={() => use.mutate("new")}
              >
                添加 {picked.length || ""} 个，添加为新分镜
              </button>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
