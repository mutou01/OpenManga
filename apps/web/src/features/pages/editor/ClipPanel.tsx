import {
  clipDuration,
  clipPlan,
  clipResolution,
  estimateClipUsd,
  LOCAL_VIDEO_MODEL,
  MAX_SHOT_SECONDS,
  providerCatalog,
  type VideoModel,
  type VideoResolution,
} from "@openmanga/domain/browser";
import type { OnScreenText, ShotVideo } from "@openmanga/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Trash2 } from "lucide-react";
import { useState } from "react";
import { assetUrl, del, get, patch, post } from "../../../api/client.ts";
import { qk, useAction } from "../../../api/hooks.ts";
import { Field, fmt, StatusChip } from "../../../components/ui.tsx";

type Clip = {
  assetId: string;
  createdAt: string;
  durationMs: number | null;
  provider: string | null;
  model: string | null;
  seconds: number | null;
  parts: number;
  resolution: string | null;
  audio: boolean;
  costUsd: number;
};
type ClipJob = { jobId: string; status: string; model: string | null; failureReason: string | null };
type Clips = {
  activeAssetId: string | null;
  clipPrompt: string | null;
  clipAudio: "mute" | "mix";
  hasArt: boolean;
  clips: Clip[];
  jobs: ClipJob[];
  prompt: string;
};
export type VideoModels = {
  models: (VideoModel & { usable: boolean })[];
  credentials: { id: string; kind: string; label: string }[];
};

const RUNNING = ["queued", "processing", "submitted"];

export const useVideoModels = () =>
  useQuery({ queryKey: ["video-models"], queryFn: () => get<VideoModels>("/video-models"), staleTime: 60_000 });

/** A model option's label: its name and what 5 s cost at the chosen resolution, or why it cannot run yet. */
export function modelLabel(m: VideoModel & { usable: boolean }, resolution: VideoResolution) {
  const usd = estimateClipUsd(m, clipDuration(m, 5), clipResolution(m, resolution), false);
  const price = m.provider === "local" ? "免费" : `${fmt.usd(usd)} / ${clipDuration(m, 5)} s`;
  const key = providerCatalog(m.provider)?.label.replace(/ \(.*\)$/, "") ?? m.provider;
  return `${m.label} — ${price}${m.usable ? "" : ` (add a ${m.provider === "fal" ? "fal" : key} key)`}`;
}

/**
 * The shot as a video clip: made from its artwork by a video model (the free still-motion model on every server, or a
 * paid one with your key for its provider, priced before it runs), compared, picked, or set aside for the still. Also what the
 * shot's clip does with its own sound, and text drawn over the shot in videos.
 */
export function ClipPanel({
  panelId,
  video,
  locked,
  invalidate,
}: {
  panelId: string;
  video: Partial<ShotVideo> | null;
  locked: boolean;
  invalidate: readonly (readonly unknown[])[];
}) {
  const qc = useQueryClient();
  const key = [...qk.panel(panelId), "clips"];
  const q = useQuery({
    queryKey: key,
    queryFn: () => get<Clips>(`/panels/${panelId}/clips`),
    refetchInterval: (r) => (r.state.data?.jobs.some((j) => RUNNING.includes(j.status)) ? 3000 : false),
  });
  const models = useVideoModels();
  const [model, setModel] = useState(LOCAL_VIDEO_MODEL);
  const [compareWith, setCompareWith] = useState("");
  const [seconds, setSeconds] = useState(5);
  const [partSeconds, setPartSeconds] = useState<number | null>(null);
  const [partNotes, setPartNotes] = useState<string[]>([]);
  const [resolution, setResolution] = useState<VideoResolution>("720p");
  const [audio, setAudio] = useState(false);
  const all = models.data?.models ?? [];
  const m = all.find((x) => x.id === model);
  const credentialFor = (id: string) => {
    const mm = all.find((x) => x.id === id);
    return mm?.provider === "local"
      ? null
      : (models.data?.credentials.find((c) => c.kind === mm?.provider)?.id ?? null);
  };
  const runs = [model, compareWith].filter(Boolean).map((id) => ({ model: id, credentialId: credentialFor(id) }));
  const estimate = runs.reduce((n, r) => {
    const mm = all.find((x) => x.id === r.model);
    return mm
      ? n +
          clipPlan(mm, seconds, partSeconds).parts *
            estimateClipUsd(
              mm,
              clipPlan(mm, seconds, partSeconds).part,
              clipResolution(mm, resolution),
              audio && mm.audio,
            )
      : n;
  }, 0);
  const done = () => {
    void qc.invalidateQueries({ queryKey: key });
    for (const k of invalidate) void qc.invalidateQueries({ queryKey: k });
  };
  const plan = m ? clipPlan(m, seconds, partSeconds) : null;
  const generate = useAction(
    () =>
      post(`/panels/${panelId}/clips`, {
        runs,
        seconds,
        resolution,
        audio,
        partSeconds,
        // Every part, blank ones as "" (they carry the action on).
        parts: plan && plan.parts > 1 ? Array.from({ length: plan.parts }, (_, k) => partNotes[k] ?? "") : undefined,
      }),
    {
      onSuccess: done,
      success: runs.length > 1 ? "正在用所选模型分别生成片段" : "正在生成片段",
    },
  );
  const use = useAction((assetId: string | null) => post(`/panels/${panelId}/clips/use`, { assetId }), {
    onSuccess: done,
    success: (r) => ((r as { activeAssetId: string | null }).activeAssetId ? "此镜头将播放所选片段" : "已改用静态图片"),
  });
  const remove = useAction((assetId: string) => del(`/clips/${assetId}`), {
    onSuccess: done,
    success: "片段已移至回收站",
  });
  const setVideo = useAction((v: Partial<ShotVideo>) => patch(`/panels/${panelId}`, { video: v }), {
    onSuccess: done,
  });
  const data = q.data;
  const active = data?.clips.find((c) => c.assetId === data.activeAssetId) ?? null;
  const text = video?.onScreenText ?? null;
  const setText = (t: Partial<OnScreenText> | null) =>
    setVideo.mutate({
      onScreenText:
        t === null || (t.text ?? text?.text ?? "").trim() === "" ? null : ({ ...text, ...t } as OnScreenText),
    });
  return (
    <details className="rounded-lg border border-[var(--border)] p-2">
      <summary className="cursor-pointer text-sm font-medium">
        <Clapperboard className="mr-1 inline size-3.5" />
        视频片段{active ? " · 使用视频片段" : ""}
      </summary>
      <fieldset disabled={locked} className="mt-2 space-y-2 text-xs">
        <p className="muted">
          导出视频时，用动态片段替代静态画格及其运镜。静态运镜免费，付费模型使用你配置的服务商密钥，并会在生成前显示报价。
        </p>
        {active && (
          <video
            key={active.assetId}
            src={assetUrl(active.assetId)}
            className="w-full rounded bg-black"
            controls
            muted
            loop
            playsInline
            aria-label="此镜头的视频片段"
          />
        )}
        <Field label="模型">
          <select
            className="input text-xs"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            aria-label="视频模型"
          >
            {all.map((x) => (
              <option key={x.id} value={x.id} disabled={!x.usable}>
                {modelLabel(x, resolution)}
              </option>
            ))}
          </select>
        </Field>
        {m && <p className="muted">{m.note}</p>}
        <div className="grid grid-cols-3 gap-1.5">
          <Field label="时长（秒）">
            <input
              className="input text-xs"
              type="number"
              min={1}
              max={MAX_SHOT_SECONDS}
              value={seconds}
              onChange={(e) => setSeconds(Math.max(1, Math.min(MAX_SHOT_SECONDS, Number(e.target.value) || 5)))}
            />
          </Field>
          <Field label="分辨率">
            <select
              className="input text-xs"
              value={resolution}
              onChange={(e) => setResolution(e.target.value as VideoResolution)}
            >
              <option value="480p">480p</option>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>
          </Field>
          <Field label="对比模型">
            <select
              className="input text-xs"
              value={compareWith}
              onChange={(e) => setCompareWith(e.target.value)}
              aria-label="对比模型"
            >
              <option value="">—</option>
              {all
                .filter((x) => x.id !== model)
                .map((x) => (
                  <option key={x.id} value={x.id} disabled={!x.usable}>
                    {x.label}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        {m && (plan?.parts ?? 1) > 1 && (
          <div className="space-y-1.5 rounded border border-[var(--border)] p-1.5">
            <div className="flex items-center gap-2">
              <span>
                分为 <strong>{plan!.parts} 段</strong>，每段 {plan!.part} 秒。从上一段的尾帧接续。
              </span>
              <select
                className="input ml-auto w-auto py-0.5 text-xs"
                aria-label="分段时长"
                value={partSeconds ?? ""}
                onChange={(e) => setPartSeconds(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">最长（{Math.max(...m.durations)} 秒）</option>
                {m.durations.map((d) => (
                  <option key={d} value={d}>
                    每段 {d} 秒
                  </option>
                ))}
              </select>
            </div>
            {Array.from({ length: plan!.parts }, (_, k) => (
              <input
                key={k}
                className="input text-xs"
                aria-label={`第 ${k + 1} 段`}
                placeholder={`${k * plan!.part}–${(k + 1) * plan!.part} 秒：${k === 0 ? "如何开始" : k === plan!.parts - 1 ? "如何结束" : "接下来发生什么"}（留空则自动接续）`}
                maxLength={600}
                value={partNotes[k] ?? ""}
                onChange={(e) =>
                  setPartNotes((n) => {
                    const next = [...n];
                    next[k] = e.target.value;
                    return next;
                  })
                }
              />
            ))}
          </div>
        )}
        {m?.audio && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} />
            同时生成声音（费用更高）
          </label>
        )}
        <Field label="动作描述" hint="留空时根据情节节点和导演设置生成。">
          <textarea
            key={`${panelId}-${data?.clipPrompt ?? ""}`}
            className="input min-h-14 text-xs"
            placeholder="例如：她转向窗户，窗帘轻拂，镜头缓慢推进"
            defaultValue={data?.clipPrompt ?? ""}
            onBlur={(e) => {
              const v = e.target.value.trim() || null;
              if (v !== (data?.clipPrompt ?? null)) setVideo.mutate({ clipPrompt: v });
            }}
          />
        </Field>
        <div className="flex items-center gap-2">
          <span className="muted">
            {plan && `${plan.total} 秒 · ${clipResolution(m!, resolution)}`}
            {runs.length > 1 ? "（每个模型）" : ""} · {estimate ? `~${fmt.usd(estimate)}` : "免费"}
          </span>
          <button
            type="button"
            className="btn-primary ml-auto px-2 py-1 text-xs"
            disabled={
              generate.isPending || !data?.hasArt || runs.some((r) => !all.find((x) => x.id === r.model)?.usable)
            }
            title={data?.hasArt ? undefined : "请先绘制镜头"}
            onClick={() => generate.mutate()}
          >
            {runs.length > 1 ? "分别生成片段" : "生成片段"}
          </button>
        </div>
        {!data?.hasArt && <p className="text-amber-600">请先绘制镜头，片段将由镜头图片生成。</p>}
        {data?.jobs
          .filter((j) => RUNNING.includes(j.status) || j.status === "failed")
          .slice(0, 4)
          .map((j) => (
            <div key={j.jobId} className="flex items-center gap-2">
              <StatusChip status={j.status} />
              <span className="truncate">{all.find((x) => x.id === j.model)?.label ?? j.model}</span>
              {j.failureReason && <span className="truncate text-red-500">{j.failureReason}</span>}
            </div>
          ))}
        {Boolean(data?.clips.length) && (
          <ul className="space-y-1" aria-label="视频片段">
            {data!.clips.map((c) => (
              <li key={c.assetId} className="flex items-center gap-1.5 rounded border border-[var(--border)] p-1">
                <video
                  src={assetUrl(c.assetId)}
                  className="h-10 w-16 rounded bg-black object-cover"
                  muted
                  playsInline
                  preload="metadata"
                  onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
                  onMouseLeave={(e) => e.currentTarget.pause()}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {all.find((x) => x.id === c.model)?.label ?? c.model}
                    {c.assetId === data!.activeAssetId && " · 正在使用"}
                  </div>
                  <div className="muted">
                    {c.durationMs ? `${(c.durationMs / 1000).toFixed(1)} 秒` : ""}
                    {c.parts > 1 ? ` · ${c.parts} 段` : ""} · {c.resolution} · {c.costUsd ? fmt.usd(c.costUsd) : "免费"}
                  </div>
                </div>
                {c.assetId !== data!.activeAssetId && (
                  <button
                    type="button"
                    className="btn-secondary px-2 py-0.5 text-xs"
                    onClick={() => use.mutate(c.assetId)}
                  >
                    使用
                  </button>
                )}
                <button
                  type="button"
                  className="btn-ghost p-1"
                  aria-label="将片段移至回收站"
                  onClick={() => remove.mutate(c.assetId)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {active && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => use.mutate(null)}>
              改用静态图片
            </button>
            {active.audio && (
              <label className="flex items-center gap-1">
                片段声音
                <select
                  className="input py-0.5 text-xs"
                  value={data!.clipAudio}
                  onChange={(e) => setVideo.mutate({ clipAudio: e.target.value as "mute" | "mix" })}
                >
                  <option value="mute">关闭</option>
                  <option value="mix">与旁白混音</option>
                </select>
              </label>
            )}
          </div>
        )}
        <Field label="画面文字" hint="在整个镜头中叠加显示，例如广告优惠或行动号召。">
          <input
            key={`${panelId}-${text?.text ?? ""}`}
            className="input text-xs"
            placeholder="例如：限时七折，仅限今天"
            maxLength={200}
            defaultValue={text?.text ?? ""}
            onBlur={(e) => {
              if (e.target.value.trim() !== (text?.text ?? "")) setText({ text: e.target.value.trim() });
            }}
          />
        </Field>
        {text && (
          <div className="grid grid-cols-2 gap-1.5">
            <select
              className="input text-xs"
              aria-label="文字位置"
              value={text.position}
              onChange={(e) => setText({ position: e.target.value as OnScreenText["position"] })}
            >
              <option value="top">顶部</option>
              <option value="center">居中</option>
              <option value="bottom">底部</option>
            </select>
            <select
              className="input text-xs"
              aria-label="文字样式"
              value={text.style}
              onChange={(e) => setText({ style: e.target.value as OnScreenText["style"] })}
            >
              <option value="headline">标题</option>
              <option value="caption">说明文字</option>
              <option value="cta">行动号召（带边框）</option>
            </select>
          </div>
        )}
      </fieldset>
    </details>
  );
}
