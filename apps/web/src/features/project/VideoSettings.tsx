import type { ProjectSettings, VideoCard, VideoWatermark } from "@openmanga/schemas";
import { ImagePlus, Music2, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, assetUrl } from "../../api/client.ts";
import { clsx, Field, Spinner, TagInput, toast } from "../../components/ui.tsx";

type Video = NonNullable<ProjectSettings["video"]>;

const CORNERS: [VideoWatermark["corner"], string][] = [
  ["top-left", "左上角"],
  ["top-right", "右上角"],
  ["bottom-left", "左下角"],
  ["bottom-right", "右下角"],
];

/**
 * Video settings, applied to every render and shown in the preview: scene-break fades, a logo watermark, intro and
 * outro cards, and the shape and resolution exports default to. A project's, or a channel profile's: `logoUpload`
 * is where a new logo goes (the project's own files, or the account's for a profile).
 */
export function VideoSection({
  logoUpload,
  musicUpload,
  projectTitle,
  chapters,
  value,
  onChange,
}: {
  logoUpload: string;
  /** Where a music track goes (a project's own files); a channel profile has no music bed. */
  musicUpload?: string;
  projectTitle: string;
  /** A project's chapters, for title cards before each (a channel profile has none). */
  chapters?: { id: string; order: number; title: string }[];
  value: ProjectSettings["video"];
  onChange: (v: Video) => void;
}) {
  const v: Video = { fadeAtSceneBreaks: false, ...value };
  const set = (patch: Partial<Video>) => onChange({ ...v, ...patch });
  const wm = v.watermark ?? null;
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const r = await api<{ asset: { id: string } }>(logoUpload, {
        method: "POST",
        body: form,
      });
      set({ watermark: { corner: "bottom-right", opacity: 0.8, size: 0.12, ...wm, assetId: r.asset.id } });
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
    }
  };
  return (
    <section className="card space-y-4 p-4">
      <div>
        <h2 className="font-medium">视频</h2>
        <p className="muted text-xs">应用于每次视频导出，并在预览中显示。</p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={v.fadeAtSceneBreaks}
          onChange={(e) => set({ fadeAtSceneBreaks: e.target.checked })}
        />
        <span>
          场景切换时淡入淡出至黑场
          <span className="muted block text-xs">
            场景切换时各用半秒淡出和淡入。可在画格的视频镜头设置中单独指定淡入淡出或硬切。
          </span>
        </span>
      </label>

      <div className="space-y-2">
        <div className="label">标志水印</div>
        <div className="flex flex-wrap items-center gap-2">
          {wm && (
            <img
              src={assetUrl(wm.assetId)}
              alt="水印标志"
              className="h-12 max-w-32 rounded border border-[var(--border)] bg-[var(--panel-2)] object-contain p-1"
            />
          )}
          <label className={clsx("btn-secondary cursor-pointer", uploading && "pointer-events-none opacity-50")}>
            {uploading ? <Spinner /> : <ImagePlus className="size-4" />} {wm ? "替换标志" : "上传标志"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void upload(f);
              }}
            />
          </label>
          {wm && (
            <button type="button" className="btn-ghost text-red-500" onClick={() => set({ watermark: null })}>
              <Trash2 className="size-4" /> 移除
            </button>
          )}
        </div>
        {wm && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="位置">
              <select
                className="input"
                value={wm.corner}
                onChange={(e) => set({ watermark: { ...wm, corner: e.target.value as VideoWatermark["corner"] } })}
              >
                {CORNERS.map(([c, label]) => (
                  <option key={c} value={c}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`不透明度 ${Math.round(wm.opacity * 100)}%`}>
              <input
                type="range"
                className="w-full"
                min={0.05}
                max={1}
                step={0.05}
                value={wm.opacity}
                onChange={(e) => set({ watermark: { ...wm, opacity: Number(e.target.value) } })}
              />
            </Field>
            <Field label={`宽度占比 ${Math.round(wm.size * 100)}%`}>
              <input
                type="range"
                className="w-full"
                min={0.03}
                max={0.4}
                step={0.01}
                value={wm.size}
                onChange={(e) => set({ watermark: { ...wm, size: Number(e.target.value) } })}
              />
            </Field>
          </div>
        )}
      </div>

      {musicUpload && <MusicBed upload={musicUpload} value={v.music ?? null} onChange={(music) => set({ music })} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <CardFields
          label="片头卡"
          value={v.intro ?? null}
          fallbackTitle={projectTitle}
          onChange={(intro) => set({ intro })}
        />
        <CardFields label="片尾卡" value={v.outro ?? null} fallbackTitle="" onChange={(outro) => set({ outro })} />
      </div>

      {chapters && chapters.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm">
            章节卡（已启用{v.chapterCards?.length ?? 0} 张），在每章第一个镜头前显示标题卡
          </summary>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            {chapters.map((ch) => {
              const card = v.chapterCards?.find((c) => c.chapterId === ch.id) ?? null;
              return (
                <CardFields
                  key={ch.id}
                  label={`第 ${ch.order} 章标题卡`}
                  value={card}
                  fallbackTitle={`第 ${ch.order} 章 · ${ch.title}`.slice(0, 120)}
                  onChange={(next) =>
                    set({
                      chapterCards: [
                        ...(v.chapterCards ?? []).filter((c) => c.chapterId !== ch.id),
                        ...(next ? [{ ...next, chapterId: ch.id }] : []),
                      ],
                    })
                  }
                />
              );
            })}
          </div>
        </details>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="导出画幅" hint="视频导出的默认画幅。Shorts 始终使用 9:16。">
          <select
            className="input"
            value={v.output?.aspect ?? "16:9"}
            onChange={(e) => set({ output: { height: 1080, ...v.output, aspect: e.target.value as Output["aspect"] } })}
          >
            <option value="16:9">16:9 横屏</option>
            <option value="9:16">9:16 竖屏</option>
            <option value="1:1">1:1 方形</option>
          </select>
        </Field>
        <Field label="导出分辨率">
          <select
            className="input"
            value={v.output?.height ?? 1080}
            onChange={(e) =>
              set({ output: { aspect: "16:9", ...v.output, height: Number(e.target.value) as Output["height"] } })
            }
          >
            <option value={720}>720p</option>
            <option value={1080}>1080p</option>
            <option value={1440}>1440p</option>
          </select>
        </Field>
      </div>
    </section>
  );
}
type Output = NonNullable<Video["output"]>;

type Publishing = Pick<ProjectSettings, "thumbnailStyle" | "youtubeRules">;
type Rules = NonNullable<ProjectSettings["youtubeRules"]>;

/** Thumbnail layout and the channel's rules for the YouTube package text: a project's, or a channel profile's. */
export function PublishingSection({ value, onChange }: { value: Publishing; onChange: (v: Publishing) => void }) {
  const rules: Rules = { titleRules: "", descriptionTemplate: "", tags: [], ...value.youtubeRules };
  const setRules = (p: Partial<Rules>) => onChange({ ...value, youtubeRules: { ...rules, ...p } });
  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="font-medium">缩略图与 YouTube 文案</h2>
        <p className="muted text-xs">
          YouTube 发布包的文案生成任务将遵循这些规则，每个发布包都会原样添加你填写的标签。
        </p>
      </div>
      <Field label="缩略图标题位置" hint="新缩略图会在画面的这一侧为标题留白。">
        <select
          className="input"
          value={value.thumbnailStyle?.side ?? "left"}
          onChange={(e) => onChange({ ...value, thumbnailStyle: { side: e.target.value as "left" | "right" } })}
        >
          <option value="left">左侧</option>
          <option value="right">右侧</option>
        </select>
      </Field>
      <Field label="标题规则">
        <textarea
          className="input min-h-16"
          maxLength={1000}
          placeholder="例如，以主角名字开头，不用问号，少于 60 个字符。"
          value={rules.titleRules}
          onChange={(e) => setRules({ titleRules: e.target.value })}
        />
      </Field>
      <Field
        label="描述模板"
        hint="{title} 和 {author} 将原样填入，模型会撰写 {hook}（两行引子）和 {summary}（无剧透摘要）。其余文字原样保留，章节时间戳附在末尾。"
      >
        <textarea
          className="input min-h-24 font-mono text-sm"
          maxLength={4000}
          placeholder={"{hook}\n\n{summary}\n\n每周五更新解说。"}
          value={rules.descriptionTemplate}
          onChange={(e) => setRules({ descriptionTemplate: e.target.value })}
        />
      </Field>
      <Field label="默认标签" hint="每个标签后按回车或输入逗号。">
        <TagInput value={rules.tags} onChange={(tags) => setRules({ tags: tags.slice(0, 30) })} />
      </Field>
    </section>
  );
}

/** One title card: on or off, its title and subtitle over the project's art, and how long it holds. */
function CardFields({
  label,
  value,
  fallbackTitle,
  onChange,
}: {
  label: string;
  value: VideoCard | null;
  fallbackTitle: string;
  onChange: (v: VideoCard | null) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked ? { title: fallbackTitle, subtitle: "", durationMs: 3000 } : null)}
        />
        {label}
      </label>
      {value && (
        <>
          <input
            className="input"
            maxLength={120}
            placeholder="标题"
            aria-label={`${label}标题`}
            value={value.title}
            onChange={(e) => onChange({ ...value, title: e.target.value })}
          />
          <input
            className="input"
            maxLength={200}
            placeholder="副标题（可选）"
            aria-label={`${label}副标题`}
            value={value.subtitle}
            onChange={(e) => onChange({ ...value, subtitle: e.target.value })}
          />
          <Field label="显示时长（秒）">
            <input
              className="input"
              type="number"
              min={1}
              max={15}
              step={0.5}
              value={value.durationMs / 1000}
              onChange={(e) =>
                e.target.value !== "" &&
                onChange({
                  ...value,
                  durationMs: Math.min(15_000, Math.max(1000, Math.round(Number(e.target.value) * 1000))),
                })
              }
            />
          </Field>
        </>
      )}
    </div>
  );
}

type Music = NonNullable<Video["music"]>;

/** A music bed under the whole video: an uploaded track, looped, at a volume, turned down while the narration speaks. */
function MusicBed({
  upload,
  value,
  onChange,
}: {
  upload: string;
  value: Music | null;
  onChange: (m: Music | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const send = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const r = await api<{ asset: { id: string; name: string } }>(upload, { method: "POST", body: form });
      setName(r.asset.name);
      onChange({ volume: 0.25, duck: true, ...value, assetId: r.asset.id });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <div className="label">背景音乐</div>
      <p className="muted text-xs">
        背景音乐在整段视频中循环播放，旁白朗读时降低音量。请使用已获授权的音乐。生成片段的原声可逐镜头设置（画格页签 →
        视频片段）。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {value && (
          <audio src={assetUrl(value.assetId)} controls className="h-8 max-w-64" aria-label="背景音乐">
            <track kind="captions" />
          </audio>
        )}
        {name && <span className="muted text-xs">{name}</span>}
        <label className={clsx("btn-secondary cursor-pointer", busy && "pointer-events-none opacity-50")}>
          {busy ? <Spinner /> : <Music2 className="size-4" />} {value ? "替换音乐" : "上传音乐"}
          <input
            type="file"
            accept="audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/mp4,.mp3,.wav,.ogg,.flac,.m4a"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void send(f);
            }}
          />
        </label>
        {value && (
          <button type="button" className="btn-ghost text-red-500" onClick={() => onChange(null)}>
            <Trash2 className="size-4" /> 移除
          </button>
        )}
      </div>
      {value && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`音量 ${Math.round(value.volume * 100)}%`}>
            <input
              type="range"
              className="w-full"
              min={0.05}
              max={1}
              step={0.05}
              value={value.volume}
              onChange={(e) => onChange({ ...value, volume: Number(e.target.value) })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.duck}
              onChange={(e) => onChange({ ...value, duck: e.target.checked })}
            />
            旁白朗读时降低音乐音量
          </label>
        </div>
      )}
    </div>
  );
}
