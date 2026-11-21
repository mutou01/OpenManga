import {
  captionsSupported,
  exportTarget,
  NARRATION_LANGUAGES,
  type PrintIssue,
  SHORTS_DEFAULT_MS,
  type TargetIssue,
  type VideoAspect,
} from "@openmanga/domain/browser";
import type { ShortsCaptions } from "@openmanga/schemas";
import { useQuery } from "@tanstack/react-query";
import { Download, FileDown, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, assetUrl, del, get, post } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import type { ChapterListItem, ExportListItem } from "../../api/types.ts";
import {
  ConfirmDialog,
  EmptyState,
  ErrorBox,
  Field,
  fmt,
  PageHeader,
  Spinner,
  StatusChip,
} from "../../components/ui.tsx";
import { readingDirectionLabel } from "../../lib/locale.ts";
import { ProgressBar } from "../generation/shared.tsx";
import { useProject, useProjectId } from "../project/ProjectLayout.tsx";
import { PreviewVideoButton } from "../video/VideoPreview.tsx";
import { ExportTargetPicker } from "./ExportTargets.tsx";
import { HookVariants } from "./HookVariants.tsx";
import { CoverCheck, PRINT_SIZES, PreflightReport, type PreflightReportData, PrintIssues } from "./PrintPanels.tsx";
import { CaptionsField, ShortsPicker } from "./ShortsPicker.tsx";
import { YoutubePackageCard } from "./YoutubePackage.tsx";

const LANGUAGE_LABELS: Record<string, string> = {
  en: "英语",
  es: "西班牙语",
  pt: "葡萄牙语",
  fr: "法语",
  de: "德语",
  it: "意大利语",
  ja: "日语",
  ko: "韩语",
  zh: "中文（普通话）",
  hi: "印地语",
  id: "印度尼西亚语",
  vi: "越南语",
  th: "泰语",
  tr: "土耳其语",
  ru: "俄语",
  ar: "阿拉伯语",
  pl: "波兰语",
  nl: "荷兰语",
};

const KINDS = [
  { value: "png_pages", label: "PNG 页面序列", chapter: true },
  { value: "jpg_pages", label: "JPG 页面序列", chapter: true },
  { value: "pdf", label: "PDF", chapter: true },
  { value: "cbz", label: "CBZ 漫画压缩包（Komga、Kavita 等阅读器）", chapter: true },
  { value: "epub", label: "EPUB 电子书（Kindle、Apple Books、Kobo）", chapter: true },
  { value: "webtoon", label: "长条漫画", chapter: true },
  { value: "print_cover", label: "印刷封面（含出血的封底、书脊与封面 PDF）", chapter: true },
  { value: "print_preflight", label: "印前检查（DPI、墨量、字体与软打样）", chapter: true },
  { value: "psd_pages", label: "逐页分层 PSD（Photoshop、Clip Studio）", chapter: true },
  {
    value: "layered_package",
    label: "原画与文字分离包（ZIP，含无字页面、SVG 与清单）",
    chapter: true,
  },
  { value: "narration_audio", label: "旁白音频包", chapter: true },
  { value: "timeline", label: "时间轴清单（JSON）", chapter: true },
  { value: "project_json", label: "项目 JSON", chapter: false },
  { value: "zip_package", label: "完整项目 ZIP 包", chapter: false },
  { value: "agent_package", label: "Agent 交接包（包含完整关联）", chapter: false },
  { value: "video_pages", label: "旁白视频（按页剪辑 MP4）", chapter: false },
  { value: "video_panels", label: "旁白视频（按画格剪辑，Ken Burns 运镜 MP4）", chapter: false },
  { value: "video_shorts", label: "短视频（关键镜头预告，最长 3 分钟 MP4）", chapter: false },
  { value: "youtube_package", label: "YouTube 发布包（最新视频、缩略图与文案）", chapter: false },
] as const;
const AREAS: Record<string, ("art" | "narration")[]> = {
  png_pages: ["art"],
  jpg_pages: ["art"],
  pdf: ["art"],
  cbz: ["art"],
  epub: ["art"],
  webtoon: ["art"],
  print_cover: [],
  print_preflight: ["art"],
  psd_pages: ["art"],
  layered_package: ["art"],
  zip_package: ["art"],
  narration_audio: ["narration"],
  timeline: ["narration"],
  agent_package: ["art", "narration"],
  video_pages: ["art", "narration"],
  video_panels: ["art", "narration"],
  video_shorts: [],
  youtube_package: ["art", "narration"],
};
const USES_LANGUAGE = new Set([
  "narration_audio",
  "timeline",
  "agent_package",
  "video_pages",
  "video_panels",
  "video_shorts",
]);
/** Page exports that letter the pages: a translated edition swaps in its translated bubbles and captions. */
const LETTERED = new Set(["png_pages", "jpg_pages", "pdf", "cbz", "epub", "webtoon"]);
const isVideo = (k: string) => k === "video_pages" || k === "video_panels" || k === "video_shorts";
/** Chapter kinds that can also cover the whole project: they stream to disk, so length costs no memory. */
const WHOLE_PROJECT = new Set([
  "png_pages",
  "jpg_pages",
  "pdf",
  "cbz",
  "epub",
  "webtoon",
  "print_cover",
  "print_preflight",
  "psd_pages",
  "layered_package",
]);
/** Kinds that take the PDF's page options: the preflight measures the PDF those options make. */
const PDF_OPTIONS = new Set(["pdf", "print_preflight"]);
type Issue = {
  code: string;
  area: "art" | "narration";
  severity: "block" | "info";
  chapterLabel: string | null;
  count: number;
  message: string;
};
type Kind = (typeof KINDS)[number]["value"];

export function ExportsPage() {
  const projectId = useProjectId();
  const { data: overview } = useProject();
  const chapters = useQuery({
    queryKey: qk.chapters(projectId),
    queryFn: () => get<{ chapters: ChapterListItem[] }>(`/projects/${projectId}/chapters`),
  });
  const jobs = useQuery({
    queryKey: qk.exports(projectId),
    queryFn: () => get<{ jobs: ExportListItem[] }>(`/projects/${projectId}/exports`),
    refetchInterval: (q) =>
      q.state.data?.jobs.some((j) => j.status === "queued" || j.status === "processing") ? 4000 : false,
  });

  const [chosenKind, setKind] = useState<Kind>();
  // A platform target: its settings applied, its limits checked before and after the export.
  const [targetKey, setTargetKey] = useState("");
  // A strip's natural export is the stitched webtoon image, not a PDF of pages that do not exist as pages.
  const format = overview?.project.settings.format;
  const kind: Kind = chosenKind ?? (format === "film" ? "video_panels" : format === "vertical" ? "webtoon" : "pdf");
  const [chapterId, setChapterId] = useState("");
  const [scale, setScale] = useState(1);
  const [jpgQuality, setJpgQuality] = useState(90);
  const [pdf, setPdf] = useState({
    pageSize: "source",
    marginMm: 0,
    bleedMm: 0,
    dpi: 300,
    readingDirection: "",
    rectoChapters: false,
    toc: false,
  });
  const [bookMeta, setBookMeta] = useState({ title: "", author: "", subject: "", keywords: "", language: "" });
  const [print, setPrint] = useState({ paper: "white", pageCount: "" });
  const [webtoon, setWebtoon] = useState({ width: 800, gap: 40, split: true, maxChunkHeight: 12000, format: "jpg" });
  const [audio, setAudio] = useState({ format: "mp3", normalize: true });
  const [includeAssets, setIncludeAssets] = useState(true);
  // A provenance record next to the files: what made them, with which models, references and licences.
  const [provenance, setProvenance] = useState(false);
  const [language, setLanguage] = useState("");
  const [editionLanguage, setEditionLanguage] = useState("");
  const [video, setVideo] = useState({
    height: 1080,
    fps: 30,
    minHoldMs: 2500,
    framing: "width" as "width" | "height" | "scroll",
    pageWidthRatio: 0.6,
    zoom: 0.06,
  });
  // Frame shape: landscape unless chosen; a Short opens vertical.
  const [chosenAspect, setAspect] = useState<VideoAspect>();
  const [shortsPick, setShortsPick] = useState<string[]>([]);
  const [shortsSeconds, setShortsSeconds] = useState(SHORTS_DEFAULT_MS / 1000);
  const [captions, setCaptions] = useState<ShortsCaptions>("off");
  // A hook variant to open a panel cut with ("" = the film as it starts).
  const [hookId, setHookId] = useState("");
  const hooks = overview?.project.settings.video?.hooks ?? [];
  // Partial renders: the first N minutes, and/or a range of pages within the chosen chapter.
  const [maxMinutes, setMaxMinutes] = useState("");
  const [pageRange, setPageRange] = useState({ from: "", to: "" });
  const [notReady, setNotReady] = useState<Issue[] | null>(null);
  // A project with a target runtime holds each shot at least its shortest shot length.
  const minShot = overview?.project.settings.targetRuntime?.minShotSeconds;
  useEffect(() => {
    if (minShot) setVideo((v) => ({ ...v, minHoldMs: Math.round(minShot * 1000) }));
  }, [minShot]);
  // The project's export defaults (Settings → Video, or its channel profile) pick the starting shape and resolution.
  const output = overview?.project.settings.video?.output;
  useEffect(() => {
    if (output?.height) setVideo((v) => ({ ...v, height: output.height }));
  }, [output?.height]);

  const needsChapter = KINDS.find((k) => k.value === kind)!.chapter;
  const shorts = kind === "video_shorts";
  const aspect: VideoAspect = chosenAspect ?? (shorts ? "9:16" : (output?.aspect ?? "16:9"));
  const [agentChapter, setAgentChapter] = useState("");
  const wholeProject = WHOLE_PROJECT.has(kind) && chapterId === "all";
  const selectedChapter = (chapterId !== "all" && chapterId) || chapters.data?.chapters[0]?.id || "";

  const scopeChapter = needsChapter
    ? wholeProject
      ? null
      : selectedChapter
    : kind === "agent_package" || isVideo(kind) || kind === "youtube_package"
      ? agentChapter || null
      : null;
  const lang = language || overview?.project.language || "en";
  const rangeChapter = useQuery({
    queryKey: qk.chapter(agentChapter),
    queryFn: () => get<{ pages: { id: string; order: number }[] }>(`/chapters/${agentChapter}`),
    enabled: isVideo(kind) && Boolean(agentChapter),
  });
  const rangePageIds = (() => {
    if (!isVideo(kind) || shorts || !agentChapter || (!pageRange.from && !pageRange.to)) return undefined;
    const pgs = rangeChapter.data?.pages ?? [];
    const lo = Number(pageRange.from) || 1;
    const hi = Number(pageRange.to) || Number.POSITIVE_INFINITY;
    return pgs.filter((p) => p.order >= lo && p.order <= hi).map((p) => p.id);
  })();
  const create = useAction(
    (acknowledgeIssues: boolean) =>
      post(`/projects/${projectId}/exports`, {
        kind,
        chapterId: scopeChapter,
        scale,
        jpgQuality,
        pdf: {
          ...pdf,
          // A cover is always a print size; it starts at KDP 6" × 9" when the PDF is set to the page's own size.
          pageSize: kind === "print_cover" && pdf.pageSize === "source" ? "kdp_6x9" : pdf.pageSize,
          readingDirection: pdf.readingDirection || undefined,
          metadata: {
            title: bookMeta.title || undefined,
            author: bookMeta.author || undefined,
            subject: bookMeta.subject || undefined,
            keywords: bookMeta.keywords
              .split(",")
              .map((k) => k.trim())
              .filter(Boolean),
            language: bookMeta.language || undefined,
          },
        },
        print: { paper: print.paper, ...(Number(print.pageCount) > 0 ? { pageCount: Number(print.pageCount) } : {}) },
        webtoon,
        audio,
        includeAssets,
        video: {
          ...video,
          // A narrow frame shows a page at its full width unless chosen otherwise.
          pageWidthRatio: aspect === "16:9" ? video.pageWidthRatio : 1,
          aspect,
          ...(shorts ? { shortsSeconds, captions: captionsSupported(lang) ? captions : "off" } : {}),
          ...(kind === "video_panels" && hooks.some((h) => h.id === hookId) ? { hookId } : {}),
          ...(isVideo(kind) && !shorts && Number(maxMinutes) > 0
            ? { maxDurationMs: Math.round(Number(maxMinutes) * 60_000) }
            : {}),
        },
        ...(rangePageIds?.length ? { pageIds: rangePageIds } : {}),
        ...(shorts ? { panelIds: shortsPick } : {}),
        ...(USES_LANGUAGE.has(kind) ? { language: lang } : {}),
        ...(LETTERED.has(kind) && editionLanguage ? { language: editionLanguage } : {}),
        ...(targetKey && exportTarget(targetKey)?.kind === kind ? { target: targetKey } : {}),
        provenance,
        acknowledgeIssues,
      }),
    {
      invalidate: [qk.exports(projectId)],
      success: "导出已加入队列",
      onSuccess: () => setNotReady(null),
    },
  );
  const submit = async (acknowledge: boolean) => {
    try {
      await create.mutateAsync(acknowledge);
    } catch (e) {
      if (e instanceof ApiError && e.code === "export_not_ready")
        setNotReady((e.details as { issues: Issue[] }).issues);
    }
  };
  const readiness = useQuery({
    queryKey: ["readiness", projectId, scopeChapter, USES_LANGUAGE.has(kind) ? lang : ""],
    queryFn: () =>
      get<{ issues: Issue[]; language: string }>(
        `/projects/${projectId}/readiness?${new URLSearchParams({
          ...(scopeChapter ? { chapterId: scopeChapter } : {}),
          ...(USES_LANGUAGE.has(kind) ? { language: lang } : {}),
        })}`,
      ),
    enabled: !(needsChapter && !selectedChapter),
  });
  const relevant = (readiness.data?.issues ?? []).filter((i) => (AREAS[kind] ?? []).includes(i.area));
  const cancel = useAction((id: string) => post(`/exports/${id}/cancel`), {
    invalidate: [qk.exports(projectId)],
    success: "已发送取消请求",
  });

  // Deleting removes the files from disk now instead of at their 30-day expiry.
  const [deleting, setDeleting] = useState<"all" | string | null>(null);
  const remove = useAction(
    (target: "all" | string) =>
      target === "all"
        ? del<{ exports: number; bytes: number }>(`/projects/${projectId}/exports`)
        : del<{ exports: number; bytes: number }>(`/exports/${target}`),
    {
      invalidate: [qk.exports(projectId), qk.project(projectId)],
      success: (r) => `已删除 ${r.exports} 个导出，释放 ${fmt.bytes(r.bytes)}`,
      onSuccess: () => setDeleting(null),
    },
  );
  const running = (st: string) => st === "queued" || st === "processing" || st === "cancel_requested";

  const num = (v: string) => Number(v);
  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader
        title="导出"
        subtitle="根据结构化页面合成导出文件，无需调用 AI。"
        actions={
          jobs.data?.jobs.some((j) => !running(j.status) && j.kind !== "project_import") ? (
            <button type="button" className="btn-ghost text-red-500" onClick={() => setDeleting("all")}>
              <Trash2 className="size-4" /> 删除全部导出
            </button>
          ) : undefined
        }
      />
      <YoutubePackageCard />
      <ConfirmDialog
        open={deleting !== null}
        title={deleting === "all" ? "删除全部导出？" : "删除此导出？"}
        confirmLabel="删除"
        danger
        busy={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        {deleting === "all"
          ? "将立即从磁盘删除此项目所有已结束的导出及其文件，正在运行的导出将保留。"
          : "将立即从磁盘删除此导出及其文件。"}{" "}
        此操作无法撤销，需要重新导出才能恢复文件。
      </ConfirmDialog>
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <form
          className="card space-y-3 self-start p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
        >
          <ExportTargetPicker
            projectId={projectId}
            kinds={KINDS.map((k) => k.value)}
            value={targetKey && exportTarget(targetKey)?.kind === kind ? targetKey : ""}
            chapterId={needsChapter ? selectedChapter || null : agentChapter || null}
            minHoldMs={video.minHoldMs}
            durationMs={shorts ? shortsSeconds * 1000 : undefined}
            onChange={(t) => {
              setTargetKey(t?.key ?? "");
              if (!t) return;
              setKind(t.kind as Kind);
              const o = t.options;
              if (o.video) {
                setAspect(o.video.aspect);
                setVideo((v) => ({ ...v, height: o.video!.height }));
              }
              if (o.webtoon) setWebtoon((w) => ({ ...w, ...o.webtoon! }));
              if (o.pdf) setPdf((p) => ({ ...p, ...o.pdf! }));
              if (o.jpgQuality) setJpgQuality(o.jpgQuality);
            }}
          />
          <Field label="格式">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
          {needsChapter && (
            <Field label="章节">
              <select
                className="input"
                value={wholeProject ? "all" : selectedChapter}
                onChange={(e) => setChapterId(e.target.value)}
              >
                {WHOLE_PROJECT.has(kind) && <option value="all">整个项目（全部章节）</option>}
                {chapters.data?.chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    第 {c.order} 章 — {c.title}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {(kind === "agent_package" || isVideo(kind) || kind === "youtube_package") && (
            <>
              <Field label="章节">
                <select className="input" value={agentChapter} onChange={(e) => setAgentChapter(e.target.value)}>
                  <option value="">
                    {isVideo(kind) || kind === "youtube_package" ? "整个项目（合并为一个视频）" : "全部章节"}
                  </option>
                  {chapters.data?.chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      第 {c.order} 章 — {c.title}
                    </option>
                  ))}
                </select>
              </Field>
              {kind === "agent_package" && (
                <p className="muted text-xs">
                  ZIP 内含 README 和
                  manifest.json，关联全部页面、画格原画与排字图、角色及场景参考图、对话和带时间信息的旁白，便于其他
                  Agent 或编辑器继续制作。
                </p>
              )}
            </>
          )}
          {(kind === "png_pages" ||
            kind === "jpg_pages" ||
            kind === "pdf" ||
            kind === "cbz" ||
            kind === "epub" ||
            kind === "psd_pages" ||
            kind === "layered_package" ||
            kind === "agent_package") && (
            <Field label={`缩放 ×${scale}`}>
              <input
                type="range"
                min={0.25}
                max={3}
                step={0.25}
                value={scale}
                onChange={(e) => setScale(num(e.target.value))}
                className="w-full"
              />
            </Field>
          )}
          {(kind === "jpg_pages" ||
            kind === "cbz" ||
            kind === "epub" ||
            (kind === "webtoon" && webtoon.format === "jpg")) && (
            <Field label={`JPG 质量 ${jpgQuality}`}>
              <input
                type="range"
                min={40}
                max={100}
                value={jpgQuality}
                onChange={(e) => setJpgQuality(num(e.target.value))}
                className="w-full"
              />
            </Field>
          )}
          {(kind === "psd_pages" || kind === "layered_package") && (
            <p className="muted text-xs">
              {kind === "psd_pages"
                ? "每页生成一个 Photoshop 文件，多页时打包为 ZIP。包含白色背景、各画格的原画、边框与隐藏布局参考线，以及特效、说明文字和对话，每个元素均按页面位置放在独立命名图层中。也可用 Clip Studio Paint 打开。"
                : "每页包含排字后的页面、无字页面、文字矢量 SVG，以及各画格原画、边框、参考线、气泡、说明文字和音效的独立透明 PNG。manifest.json 记录每个文件在页面中的位置、尺寸、图层顺序与文字。"}
            </p>
          )}
          {kind === "print_cover" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="印刷尺寸">
                <select
                  className="input"
                  value={pdf.pageSize === "source" ? "kdp_6x9" : pdf.pageSize}
                  onChange={(e) => setPdf({ ...pdf, pageSize: e.target.value })}
                >
                  {PRINT_SIZES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="纸张">
                <select
                  className="input"
                  value={print.paper}
                  onChange={(e) => setPrint({ ...print, paper: e.target.value })}
                >
                  <option value="white">白纸</option>
                  <option value="cream">米色纸</option>
                  <option value="color">彩色印刷用纸</option>
                </select>
              </Field>
              <Field label="页数" hint="留空时使用内页页数">
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={2000}
                  placeholder="内页页数"
                  value={print.pageCount}
                  onChange={(e) => setPrint({ ...print, pageCount: e.target.value })}
                />
              </Field>
              <Field label="DPI">
                <input
                  type="number"
                  className="input"
                  min={72}
                  max={600}
                  value={pdf.dpi}
                  onChange={(e) => setPdf({ ...pdf, dpi: num(e.target.value) })}
                />
              </Field>
              <div className="col-span-2">
                <CoverCheck
                  projectId={projectId}
                  chapterId={scopeChapter}
                  pageSize={pdf.pageSize === "source" ? "kdp_6x9" : pdf.pageSize}
                  paper={print.paper}
                  pageCount={print.pageCount}
                  toc={pdf.toc}
                  rectoChapters={pdf.rectoChapters}
                />
              </div>
              <p className="muted col-span-2 text-xs">
                封底、书脊与封面合为一份 PDF，出血为 0.125 英寸。封面使用项目封面原画、标题与作者，79
                页及以上时在书脊显示标题，封底简介位于条形码区上方。页数按内页及下方目录和章节右页起始选项计算。
              </p>
            </div>
          )}
          {PDF_OPTIONS.has(kind) && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="页面尺寸">
                <select
                  className="input"
                  value={pdf.pageSize}
                  onChange={(e) => setPdf({ ...pdf, pageSize: e.target.value })}
                >
                  {["source", "A4", "A5", "B5", "letter", "tankobon"].map((s) => (
                    <option key={s} value={s}>
                      {{ source: "原始尺寸", letter: "美式信纸", tankobon: "单行本" }[s] ?? s}
                    </option>
                  ))}
                  <optgroup label="Amazon KDP 印刷（满版出血）">
                    {[
                      ["kdp_5x8", '5" × 8"'],
                      ["kdp_5_5x8_5", '5.5" × 8.5"'],
                      ["kdp_6x9", '6" × 9"'],
                      ["kdp_7x10", '7" × 10"'],
                      ["kdp_8_5x11", '8.5" × 11"'],
                    ].map(([v, l]) => (
                      <option key={v} value={v}>
                        KDP {l}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </Field>
              {pdf.pageSize.startsWith("kdp_") && (
                <p className="muted col-span-2 text-xs">
                  Amazon KDP 内页采用满版出血，外侧裁切 0.125 英寸，文字应避开页面边缘。封面需单独上传。当前导出预设按
                  300 DPI 检查，小页面可提高缩放倍率，平装书至少需要 24 页。
                </p>
              )}
              <Field label="DPI">
                <input
                  type="number"
                  className="input"
                  min={72}
                  max={600}
                  value={pdf.dpi}
                  onChange={(e) => setPdf({ ...pdf, dpi: num(e.target.value) })}
                />
              </Field>
              <Field label="页边距（毫米）">
                <input
                  type="number"
                  className="input"
                  min={0}
                  max={50}
                  value={pdf.marginMm}
                  onChange={(e) => setPdf({ ...pdf, marginMm: num(e.target.value) })}
                />
              </Field>
              <Field label="出血（毫米）">
                <input
                  type="number"
                  className="input"
                  min={0}
                  max={10}
                  value={pdf.bleedMm}
                  onChange={(e) => setPdf({ ...pdf, bleedMm: num(e.target.value) })}
                />
              </Field>
              <Field label="阅读方向">
                <select
                  className="input"
                  value={pdf.readingDirection}
                  onChange={(e) => setPdf({ ...pdf, readingDirection: e.target.value })}
                >
                  <option value="">
                    项目默认（{readingDirectionLabel(overview?.project.readingDirection ?? "ltr")}）
                  </option>
                  <option value="ltr">从左到右</option>
                  <option value="rtl">从右到左</option>
                  <option value="vertical">竖排</option>
                </select>
              </Field>
            </div>
          )}
          {(PDF_OPTIONS.has(kind) || kind === "print_cover") && (
            <div className="space-y-1 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={pdf.rectoChapters}
                  onChange={(e) => setPdf({ ...pdf, rectoChapters: e.target.checked })}
                />{" "}
                章节从右页开始（补充空白页）
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={pdf.toc} onChange={(e) => setPdf({ ...pdf, toc: e.target.checked })} />{" "}
                目录页
              </label>
            </div>
          )}
          {kind === "pdf" && (
            <details className="text-sm">
              <summary className="cursor-pointer">书籍元数据</summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <Field label="标题">
                    <input
                      className="input"
                      placeholder={overview?.project.title}
                      value={bookMeta.title}
                      onChange={(e) => setBookMeta({ ...bookMeta, title: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="作者">
                  <input
                    className="input"
                    placeholder={overview?.project.settings.author || "项目作者"}
                    value={bookMeta.author}
                    onChange={(e) => setBookMeta({ ...bookMeta, author: e.target.value })}
                  />
                </Field>
                <Field label="语言">
                  <input
                    className="input"
                    placeholder={overview?.project.language}
                    value={bookMeta.language}
                    onChange={(e) => setBookMeta({ ...bookMeta, language: e.target.value })}
                  />
                </Field>
                <div className="col-span-2">
                  <Field label="主题" hint="留空时使用项目简介">
                    <input
                      className="input"
                      value={bookMeta.subject}
                      onChange={(e) => setBookMeta({ ...bookMeta, subject: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="col-span-2">
                  <Field label="关键词" hint="用英文逗号分隔">
                    <input
                      className="input"
                      value={bookMeta.keywords}
                      onChange={(e) => setBookMeta({ ...bookMeta, keywords: e.target.value })}
                    />
                  </Field>
                </div>
              </div>
            </details>
          )}
          {kind === "webtoon" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="宽度（像素）">
                <input
                  type="number"
                  className="input"
                  min={320}
                  max={2000}
                  value={webtoon.width}
                  onChange={(e) => setWebtoon({ ...webtoon, width: num(e.target.value) })}
                />
              </Field>
              <Field label="间距（像素）">
                <input
                  type="number"
                  className="input"
                  min={0}
                  max={1000}
                  value={webtoon.gap}
                  onChange={(e) => setWebtoon({ ...webtoon, gap: num(e.target.value) })}
                />
              </Field>
              <Field label="格式">
                <select
                  className="input"
                  value={webtoon.format}
                  onChange={(e) => setWebtoon({ ...webtoon, format: e.target.value })}
                >
                  <option value="jpg">JPG</option>
                  <option value="png">PNG</option>
                </select>
              </Field>
              <Field label="单张切片最大高度">
                <input
                  type="number"
                  className="input"
                  min={1000}
                  max={40000}
                  disabled={!webtoon.split}
                  value={webtoon.maxChunkHeight}
                  onChange={(e) => setWebtoon({ ...webtoon, maxChunkHeight: num(e.target.value) })}
                />
              </Field>
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={webtoon.split}
                  onChange={(e) => setWebtoon({ ...webtoon, split: e.target.checked })}
                />{" "}
                按平台限制拆分切片
              </label>
            </div>
          )}
          {kind === "narration_audio" && (
            <div className="grid grid-cols-2 items-end gap-2">
              <Field label="音频格式">
                <select
                  className="input"
                  value={audio.format}
                  onChange={(e) => setAudio({ ...audio, format: e.target.value })}
                >
                  <option>mp3</option>
                  <option>ogg</option>
                  <option>wav</option>
                </select>
              </Field>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={audio.normalize}
                  onChange={(e) => setAudio({ ...audio, normalize: e.target.checked })}
                />{" "}
                统一响度
              </label>
            </div>
          )}
          {LETTERED.has(kind) && (
            <Field label="排字语言" hint="使用译文版本的气泡与说明文字，沿用原画（章节 → 翻译排字）。">
              <select className="input" value={editionLanguage} onChange={(e) => setEditionLanguage(e.target.value)}>
                <option value="">原文</option>
                {NARRATION_LANGUAGES.filter((l) => l.code !== overview?.project.language).map((l) => (
                  <option key={l.code} value={l.code}>
                    {LANGUAGE_LABELS[l.code] ?? l.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {USES_LANGUAGE.has(kind) && (
            <Field label={isVideo(kind) ? "旁白与排字语言" : "旁白语言"}>
              <select className="input" value={lang} onChange={(e) => setLanguage(e.target.value)}>
                {NARRATION_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {LANGUAGE_LABELS[l.code] ?? l.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {isVideo(kind) && (
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                {shorts ? (
                  <ShortsPicker
                    projectId={projectId}
                    chapterId={agentChapter || null}
                    language={lang}
                    minHoldMs={video.minHoldMs}
                    aspect={aspect}
                    lengthSeconds={shortsSeconds}
                    onLength={setShortsSeconds}
                    value={shortsPick}
                    onChange={setShortsPick}
                  />
                ) : agentChapter ? (
                  <PreviewVideoButton
                    projectId={projectId}
                    scope={{ chapterId: agentChapter }}
                    label="先在浏览器预览"
                    title="渲染前预览"
                    className="btn-secondary w-full"
                    defaultAspect={aspect}
                    defaultMinHoldMs={video.minHoldMs}
                    hookId={kind === "video_panels" ? hookId || undefined : undefined}
                  />
                ) : (
                  <p className="muted text-xs">选择章节后，可在渲染前通过浏览器预览。</p>
                )}
              </div>
              <Field label="分辨率">
                <select
                  className="input"
                  value={video.height}
                  onChange={(e) => setVideo({ ...video, height: num(e.target.value) })}
                >
                  <option value={720}>720p</option>
                  <option value={1080}>1080p</option>
                  <option value={1440}>1440p</option>
                </select>
              </Field>
              <Field label="画面比例">
                <select className="input" value={aspect} onChange={(e) => setAspect(e.target.value as VideoAspect)}>
                  <option value="16:9">16:9 横屏</option>
                  <option value="9:16">9:16 竖屏（Shorts、Reels）</option>
                  <option value="1:1">1:1 方形</option>
                </select>
              </Field>
              {shorts && <CaptionsField value={captions} onChange={setCaptions} language={lang} />}
              {kind === "video_panels" && (
                <Field label="开场" hint="先播放所选开场变体，再播放片头卡与正片。">
                  <select className="input" value={hookId} onChange={(e) => setHookId(e.target.value)}>
                    <option value="">使用原始开场</option>
                    {hooks.map((h) => (
                      <option key={h.id} value={h.id}>
                        开场：{h.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {kind === "video_panels" && overview && (
                <HookVariants
                  key={JSON.stringify(hooks)}
                  projectId={projectId}
                  video={overview.project.settings.video}
                />
              )}
              {!shorts && (
                <Field label="仅导出前几分钟（用于检查）">
                  <input
                    className="input"
                    type="number"
                    min={1}
                    step={1}
                    placeholder="完整视频"
                    value={maxMinutes}
                    onChange={(e) => setMaxMinutes(e.target.value)}
                  />
                </Field>
              )}
              {agentChapter && !shorts && (
                <Field label="页面范围（起始至结束）">
                  <div className="flex items-center gap-1">
                    <input
                      className="input"
                      type="number"
                      min={1}
                      placeholder="首页"
                      aria-label="起始页"
                      value={pageRange.from}
                      onChange={(e) => setPageRange({ ...pageRange, from: e.target.value })}
                    />
                    <span className="muted">–</span>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      placeholder="末页"
                      aria-label="结束页"
                      value={pageRange.to}
                      onChange={(e) => setPageRange({ ...pageRange, to: e.target.value })}
                    />
                  </div>
                </Field>
              )}
              <Field label={kind === "video_pages" ? "每页最短时长（秒）" : "每画格最短时长（秒）"}>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={30}
                  step={0.5}
                  value={video.minHoldMs / 1000}
                  onChange={(e) => setVideo({ ...video, minHoldMs: Math.round(num(e.target.value) * 1000) })}
                />
              </Field>
              {kind !== "video_pages" ? (
                <div className="col-span-2">
                  <Field label={`Ken Burns 缩放 ${Math.round(video.zoom * 100)}%`}>
                    <input
                      type="range"
                      min={0}
                      max={0.15}
                      step={0.01}
                      value={video.zoom}
                      onChange={(e) => setVideo({ ...video, zoom: num(e.target.value) })}
                      className="w-full"
                    />
                  </Field>
                </div>
              ) : (
                <div className="col-span-2">
                  <Field label="页面取景">
                    <select
                      className="input"
                      value={video.framing}
                      onChange={(e) => setVideo({ ...video, framing: e.target.value as typeof video.framing })}
                    >
                      <option value="width">占画面宽度的 3/5，缓慢滚动（便于阅读）</option>
                      <option value="scroll">占画面宽度的 3/5，连续滚动整页</option>
                      <option value="height">显示整页（文字较小）</option>
                    </select>
                  </Field>
                </div>
              )}
              <p className="muted col-span-2 text-xs">
                {shorts
                  ? "所选镜头按故事顺序播放，配各自的旁白，最长为指定时长，省略片头与片尾卡。竖屏和方形画面围绕焦点裁切画格原画，继续应用标志水印。"
                  : kind === "video_panels"
                    ? "各画格原画按页面裁切填满画面，配各自的旁白，背景为原画的模糊副本。远景缓慢推进，特写缓慢拉远。缺少原画时使用已排字页面的对应区域。"
                    : video.framing === "scroll"
                      ? "每页按自身旁白时长播放，至少达到最短时长，以模糊副本为背景，在播放期间从顶部滚动到底部。"
                      : "每页按自身旁白时长播放，至少达到最短时长，以模糊副本为背景，长页面滚动速度最高为每秒 60 像素。"}{" "}
                镜头采用硬切，整片统一音频响度，导出文件会核对旁白时长，并附带 .srt 字幕文件。
              </p>
            </div>
          )}
          <ReadinessList issues={relevant} loading={readiness.isLoading} />
          {kind === "zip_package" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeAssets} onChange={(e) => setIncludeAssets(e.target.checked)} />{" "}
              包含参考图、画格与音频文件
            </label>
          )}
          <ConfirmDialog
            open={Boolean(notReady)}
            title="仍要导出？"
            confirmLabel="仍然导出"
            busy={create.isPending}
            onClose={() => setNotReady(null)}
            onConfirm={() => void submit(true)}
          >
            <p className="mb-2">导出就绪检查发现问题，导出文件将附带问题清单。</p>
            <ReadinessList issues={notReady ?? []} loading={false} />
          </ConfirmDialog>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={provenance}
              onChange={(e) => setProvenance(e.target.checked)}
            />
            <span>
              包含来源记录
              <span className="muted block text-xs">
                记录应用版本、故事修订版、各画格模型与提示词版本、参考素材、语音、字体及许可说明，提供 JSON 和可读页面。
              </span>
            </span>
          </label>
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={create.isPending || (needsChapter && !selectedChapter) || (shorts && !shortsPick.length)}
          >
            {create.isPending ? <Spinner /> : <FileDown className="size-4" />} 导出
          </button>
          {needsChapter && !chapters.isLoading && !chapters.data?.chapters.length && (
            <p className="muted text-xs">请先创建章节。</p>
          )}
        </form>

        <div>
          {jobs.error && <ErrorBox error={jobs.error} onRetry={() => jobs.refetch()} />}
          {jobs.isLoading ? (
            <Spinner />
          ) : !jobs.data?.jobs.length ? (
            <EmptyState icon={<Download className="size-8" />} title="暂无导出">
              选择格式后即可导出。
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {jobs.data.jobs.map((j) => (
                <li key={j.id} className="card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {j.kind === "project_import"
                        ? "项目导入"
                        : j.kind === "carousel"
                          ? "轮播图片（ZIP）"
                          : j.kind === "quote_image"
                            ? "金句图片"
                            : (KINDS.find((k) => k.value === j.kind)?.label ?? j.kind)}
                    </span>
                    {j.chapter && (
                      <span className="rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-xs" title={j.chapter.title}>
                        第 {j.chapter.order} 章 — {j.chapter.title}
                      </span>
                    )}
                    <StatusChip status={j.status} />
                    <span className="muted text-xs">{fmt.ago(j.createdAt)}</span>
                    {(j.status === "queued" || j.status === "processing") && (
                      <button type="button" className="btn-ghost ml-auto" onClick={() => cancel.mutate(j.id)}>
                        <XCircle className="size-4" /> 取消
                      </button>
                    )}
                    {!running(j.status) && (
                      <button
                        type="button"
                        className="btn-ghost ml-auto p-1.5"
                        aria-label="删除导出"
                        title="删除此导出及其文件"
                        onClick={() => setDeleting(j.id)}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                  {j.status === "processing" && (
                    <div className="mt-2">
                      <ProgressBar value={j.progress} label="导出进度" />
                    </div>
                  )}
                  {j.failureReason && <p className="mt-1 text-sm text-red-500">{j.failureReason}</p>}
                  {j.status === "completed" && (j.result?.warnings as string[] | undefined)?.length ? (
                    <details className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                      <summary className="cursor-pointer">{(j.result!.warnings as string[]).length} 条导入警告</summary>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {(j.result!.warnings as string[]).map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {j.status === "completed" && j.result?.targetCheck
                    ? (() => {
                        const tc = j.result.targetCheck as { label: string; issues: TargetIssue[] };
                        return tc.issues.length ? (
                          <ul className="mt-1 space-y-0.5 text-xs" aria-label={`${tc.label} 检查`}>
                            {tc.issues.map((i) => (
                              <li key={i.code} className={i.level === "block" ? "text-red-600" : "text-amber-600"}>
                                {tc.label}: {i.message}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-xs text-emerald-600">符合 {tc.label} 的限制。</p>
                        );
                      })()
                    : null}
                  {j.status === "completed" && j.kind === "print_preflight" && j.result?.preflight ? (
                    <PreflightReport
                      report={j.result.preflight as PreflightReportData}
                      grey={overview?.project.colorMode !== "full_color"}
                    />
                  ) : null}
                  {j.status === "completed" && j.kind === "print_cover" && j.result?.cover ? (
                    <CoverResult
                      cover={j.result.cover as CoverResultData}
                      guides={j.files.find((f) => f.fileName.endsWith("_cover_guides.png"))?.assetId}
                    />
                  ) : null}
                  {j.files.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {j.files.map((f) => (
                        <a
                          key={f.id}
                          className="btn-secondary max-w-full"
                          href={assetUrl(f.assetId, undefined, f.fileName)}
                          title={f.fileName}
                        >
                          <Download className="size-4 shrink-0" /> <span className="truncate">{f.fileName}</span>
                          <span className="muted shrink-0">({fmt.bytes(f.byteSize)})</span>
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ReadinessList({ issues, loading }: { issues: Issue[]; loading: boolean }) {
  if (loading) return null;
  const blocking = issues.filter((i) => i.severity === "block");
  if (!issues.length) return <p className="text-xs text-emerald-600">导出就绪检查通过，无缺失项。</p>;
  return (
    <div
      className={
        blocking.length
          ? "rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300"
          : "muted rounded-lg border border-[var(--border)] p-2 text-xs"
      }
    >
      <p className="font-medium">
        {blocking.length ? `导出就绪检查发现 ${blocking.length} 个问题，将随文件一并导出` : "导出就绪提示"}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {issues.map((i) => (
          <li key={`${i.code}-${i.chapterLabel}`} className={i.severity === "info" ? "opacity-70" : ""}>
            {i.chapterLabel ? `${i.chapterLabel}: ` : ""}
            {i.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

type CoverResultData = { spineIn: number; widthIn: number; heightIn: number; pageCount: number; issues: PrintIssue[] };

function CoverResult({ cover, guides }: { cover: CoverResultData; guides?: string }) {
  return (
    <div className="mt-2 space-y-2">
      <p className="muted text-xs">
        {cover.pageCount} 页，书脊 {cover.spineIn.toFixed(3)} 英寸，含出血的完整封面 {cover.widthIn.toFixed(3)} ×{" "}
        {cover.heightIn.toFixed(3)} 英寸。
      </p>
      <PrintIssues issues={cover.issues} ok="封面检查通过，无需修正。" />
      {guides && (
        <img
          className="w-full max-w-xl rounded border border-[var(--border)]"
          src={assetUrl(guides)}
          alt="带有裁切线、安全区、书脊与条形码参考线的封面"
        />
      )}
    </div>
  );
}
