import { LOCAL_VIDEO_MODEL, type VideoResolution } from "@openmanga/domain/browser";
import { useState } from "react";
import { post } from "../../api/client.ts";
import { useAction } from "../../api/hooks.ts";
import { Field, fmt } from "../../components/ui.tsx";
import { modelLabel, useVideoModels } from "../pages/editor/ClipPanel.tsx";

type Estimate = { shots: number; seconds: number; usd: number; model: string };

/**
 * Chapter → Animate shots: a video clip for every drawn shot with one model, priced first (how many shots, seconds
 * and dollars), then made in the background; each clip becomes its shot's when it lands.
 */
export function AnimateShots({ chapterId }: { chapterId: string }) {
  const models = useVideoModels();
  const [model, setModel] = useState(LOCAL_VIDEO_MODEL);
  const [seconds, setSeconds] = useState(5);
  const [resolution, setResolution] = useState<VideoResolution>("720p");
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const all = models.data?.models ?? [];
  const m = all.find((x) => x.id === model);
  const body = () => ({
    ai: {
      model,
      credentialId:
        m?.provider === "local" ? null : (models.data?.credentials.find((c) => c.kind === m?.provider)?.id ?? null),
    },
    seconds,
    resolution,
    onlyMissing,
  });
  const price = useAction(
    () => post<{ estimate: Estimate; skipped: unknown[] }>(`/chapters/${chapterId}/clips`, { ...body(), dryRun: true }),
    { onSuccess: (r) => setEstimate(r.estimate) },
  );
  const run = useAction(() => post<{ estimate: Estimate }>(`/chapters/${chapterId}/clips`, body()), {
    success: (r) => `Making ${(r as { estimate: Estimate }).estimate.shots} clips`,
    onSuccess: () => setEstimate(null),
  });
  const changed = () => setEstimate(null);
  return (
    <details className="card p-4">
      <summary className="cursor-pointer font-semibold">制作镜头动画</summary>
      <div className="mt-3 space-y-2 text-sm">
        <p className="muted">
          为本章每个已绘制镜头生成视频片段，视频中会用片段呈现该镜头。请先查看费用，付费模型会使用你提供的服务商密钥。
        </p>
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label="模型">
            <select
              className="input"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                changed();
              }}
            >
              {all.map((x) => (
                <option key={x.id} value={x.id} disabled={!x.usable}>
                  {modelLabel(x, resolution)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="单个镜头时长（秒）" hint="超过模型单段时长上限，将分段续接生成">
            <input
              className="input"
              type="number"
              min={1}
              max={60}
              value={seconds}
              onChange={(e) => {
                setSeconds(Math.max(1, Math.min(60, Number(e.target.value) || 5)));
                changed();
              }}
            />
          </Field>
          <Field label="分辨率">
            <select
              className="input"
              value={resolution}
              onChange={(e) => {
                setResolution(e.target.value as VideoResolution);
                changed();
              }}
            >
              <option value="480p">480p</option>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>
          </Field>
          <label className="flex items-end gap-2 pb-2">
            <input
              type="checkbox"
              checked={onlyMissing}
              onChange={(e) => {
                setOnlyMissing(e.target.checked);
                changed();
              }}
            />
            仅处理缺少视频片段的镜头
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary" disabled={price.isPending} onClick={() => price.mutate()}>
            查看费用
          </button>
          {estimate && (
            <>
              <span>
                {estimate.shots} 个镜头 · {estimate.seconds} 秒视频 ·{" "}
                <strong>{estimate.usd ? fmt.usd(estimate.usd) : "免费"}</strong>
              </span>
              <button
                type="button"
                className="btn-primary"
                disabled={!estimate.shots || run.isPending}
                onClick={() => run.mutate()}
              >
                制作动画 {estimate.shots} 个镜头
              </button>
            </>
          )}
        </div>
      </div>
    </details>
  );
}
