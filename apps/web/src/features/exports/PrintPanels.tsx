import type { CoverLayout, PrintIssue } from "@openmanga/domain/browser";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { API_BASE, get } from "../../api/client.ts";
import { Field, Spinner } from "../../components/ui.tsx";

export const PRINT_SIZES = [
  ["kdp_5x8", 'KDP 5" × 8"'],
  ["kdp_5_5x8_5", 'KDP 5.5" × 8.5"'],
  ["kdp_6x9", 'KDP 6" × 9"'],
  ["kdp_7x10", 'KDP 7" × 10"'],
  ["kdp_8_5x11", 'KDP 8.5" × 11"'],
  ["A4", "A4"],
  ["A5", "A5"],
  ["B5", "B5"],
  ["letter", "美式信纸"],
  ["tankobon", "单行本"],
] as const;

const inches = (v: number) => `${v.toFixed(3)}"`;

// Match complete server messages so user text and unfamiliar diagnostics keep their original content.
const PRINT_ISSUE_MESSAGES: Partial<Record<PrintIssue["code"], (message: string) => string>> = {
  no_cover_art: (message) =>
    message.replace(
      /^The front needs cover art\. Generate or upload the project cover first\.$/,
      "封面缺少原画，请先生成或上传项目封面。",
    ),
  page_count_low: (message) =>
    message.replace(/^(\d+) pages: KDP prints paperbacks of (\d+) pages or more\.$/, "$1 页，KDP 平装书至少 $2 页。"),
  page_count_high: (message) =>
    message.replace(
      /^(\d+) pages: KDP prints at most (\d+) on (white|cream|color) paper\.$/,
      (_, pages: string, limit: string, paper: string) =>
        `${pages} 页，KDP 使用${{ white: "白纸", cream: "米色纸", color: "彩色印刷用纸" }[paper]}时最多 ${limit} 页。`,
    ),
  art_low_dpi: (message) =>
    message.replace(
      /^The cover art is (\d+) DPI at print size \((\d+) recommended\) and will print soft\. Use art of at least (\d+) × (\d+) px\.$/,
      "封面原画在印刷尺寸下为 $1 DPI，建议 $2 DPI，印刷后可能模糊。请使用至少 $3 × $4 像素的原画。",
    ),
  spine_no_text: (message) =>
    message.replace(
      /^Under (\d+) pages KDP allows no spine text, so the spine is left plain\.$/,
      "少于 $1 页时 KDP 不允许书脊文字，因此书脊将留空。",
    ),
  spine_text_small: (message) =>
    message.replace(
      /^The spine is ([\d.]+)" wide: its text would be ([\d.]+) pt, too small to read, so the spine is left plain\.$/,
      "书脊宽 $1 英寸，对应文字字号为 $2 磅，过小而难以阅读，因此书脊将留空。",
    ),
  spine_text_cut: (message) =>
    message.replace(/^The title is too long for the spine and was shortened\.$/, "标题超出书脊可用长度，已截短。"),
  title_cut: (message) =>
    message.replace(
      /^The title is too long for the front at 14 pt and was shortened\.$/,
      "标题使用 14 磅字号仍超出封面可用长度，已截短。",
    ),
  back_text_cut: (message) =>
    message.replace(
      /^The description is too long for the back cover at 8 pt and was shortened\.$/,
      "简介使用 8 磅字号仍超出封底可用长度，已截短。",
    ),
  low_dpi: (message) =>
    message.replace(
      /^Page ([\d, ]+(?: and \d+ more)?) prints? below (\d+) DPI \(lowest (\d+)\)\. Raise the export scale or use larger art\.$/,
      (_, pages: string, dpi: string, lowest: string) =>
        `第 ${pages.replace(/ and (\d+) more$/, " 等页，另有 $1 页")} 页低于 ${dpi} DPI，最低 ${lowest} DPI。请提高导出缩放倍率或使用更大的原画。`,
    ),
  ink_over_limit: (message) =>
    message.replace(
      /^Page ([\d, ]+(?: and \d+ more)?) go(?:es)? over (\d+)% total ink \(most ([\d.]+)%\): dark areas may smear or take long to dry\.$/,
      (_, pages: string, limit: string, max: string) =>
        `第 ${pages.replace(/ and (\d+) more$/, " 等页，另有 $1 页")} 页总墨量超过 ${limit}%，最高 ${max}%，深色区域可能蹭脏或干燥缓慢。`,
    ),
  text_outside_safe: (message) =>
    message
      .replace(
        /^Lettering on page ([\d, ]+(?: and \d+ more)?) reaches outside the safe area and may be trimmed or lost in the binding\.$/,
        (_, pages: string) =>
          `第 ${pages.replace(/ and (\d+) more$/, " 等页，另有 $1 页")} 页的文字超出安全区，可能被裁切或遮入装订处。`,
      )
      .replace(
        /^Text on the ((?:(?:front|back|spine|bleed)(?: and )?)+) reaches outside the safe area and may be trimmed or folded\.$/,
        (_, places: string) =>
          `${places
            .split(" and ")
            .map((place) => ({ front: "封面", back: "封底", spine: "书脊", bleed: "出血区" })[place])
            .join("、")}的文字超出安全区，可能被裁切或折入装订处。`,
      ),
  odd_page_count: (message) =>
    message.replace(
      /^(\d+) pages, an odd count: a printed book adds a blank last page\.$/,
      "$1 页为奇数，印刷时会在末尾补一张空白页。",
    ),
  font_missing: (message) =>
    message.replace(
      /^"([\s\S]+)" is not installed on the render server, so its lettering was drawn in Comic Neue or DejaVu Sans instead\.$/,
      "渲染服务器未安装“$1”，已使用 Comic Neue 或 DejaVu Sans 绘制文字。",
    ),
  fonts_rasterized: (message) =>
    message.replace(
      /^The PDF holds page images only: lettering is drawn into the pixels at the page's resolution, so no font needs embedding\.$/,
      "PDF 保存页面图片，文字已按页面分辨率栅格化，无需嵌入字体。",
    ),
};

/** Problems first, then notes; "info" lines say how it will print rather than what is wrong. */
export function PrintIssues({ issues, ok }: { issues: PrintIssue[]; ok: string }) {
  if (!issues.length) return <p className="text-xs text-emerald-600">{ok}</p>;
  const rank = { block: 0, warn: 1, info: 2 };
  return (
    <ul className="space-y-1 text-xs">
      {[...issues]
        .sort((a, b) => rank[a.severity] - rank[b.severity])
        .map((i) => (
          <li
            key={`${i.code}-${PRINT_ISSUE_MESSAGES[i.code]?.(i.message) ?? i.message}`}
            className={
              i.severity === "info"
                ? "muted"
                : i.severity === "block"
                  ? "text-red-600 dark:text-red-400"
                  : "text-amber-700 dark:text-amber-300"
            }
          >
            {PRINT_ISSUE_MESSAGES[i.code]?.(i.message) ?? i.message}
          </li>
        ))}
    </ul>
  );
}

/** The cover's size and spine for the chosen print options, checked before anything is rendered. */
export function CoverCheck(props: {
  projectId: string;
  chapterId: string | null;
  pageSize: string;
  paper: string;
  pageCount: string;
  toc: boolean;
  rectoChapters: boolean;
}) {
  const q = new URLSearchParams({
    pageSize: props.pageSize,
    paper: props.paper,
    toc: String(props.toc),
    rectoChapters: String(props.rectoChapters),
    ...(props.chapterId ? { chapterId: props.chapterId } : {}),
    ...(Number(props.pageCount) > 0 ? { pageCount: props.pageCount } : {}),
  });
  const check = useQuery({
    queryKey: ["print-cover", props.projectId, q.toString()],
    queryFn: () => get<{ pageCount: number; layout: CoverLayout }>(`/projects/${props.projectId}/print/cover?${q}`),
  });
  if (check.isLoading) return <Spinner />;
  if (!check.data) return null;
  const { layout, pageCount } = check.data;
  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] p-2 text-xs" data-testid="cover-check">
      <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5">
        <dt className="muted">页数</dt>
        <dd>{pageCount}</dd>
        <dt className="muted">书脊</dt>
        <dd>{inches(layout.spineIn)}</dd>
        <dt className="muted">含出血的完整封面</dt>
        <dd>
          {inches(layout.widthIn)} × {inches(layout.heightIn)}
        </dd>
        {layout.artDpi !== null && (
          <>
            <dt className="muted">封面原画</dt>
            <dd>{layout.artDpi} DPI</dd>
          </>
        )}
      </dl>
      <PrintIssues issues={layout.issues} ok="封面检查通过，无需修正。" />
    </div>
  );
}

type PreflightRow = {
  page: number;
  kind: string;
  pageId?: string;
  chapter?: number;
  order?: number;
  imageDpi?: number;
  artDpi?: number | null;
  inkPct?: number;
  shiftPct?: number;
  textOutsideSafe?: string[];
};
export type PreflightReportData = {
  pageCount: number;
  evenPageCount: boolean;
  inkModel: string;
  inkLimitPct: number;
  minDpi: number;
  lowestDpi: number;
  maxInkPct: number;
  mostShiftedPage: { page: number; pageId: string; shiftPct: number } | null;
  fonts: { family: string; uses: number; installed: boolean | null }[];
  issues: PrintIssue[];
  pages: PreflightRow[];
};

/** A finished preflight: the summary, the issues, the fonts, every page's numbers, and a soft proof of any page. */
export function PreflightReport({ report, grey }: { report: PreflightReportData; grey: boolean }) {
  const pages = report.pages.filter((p) => p.pageId);
  const [pageId, setPageId] = useState(report.mostShiftedPage?.pageId ?? pages[0]?.pageId ?? "");
  const flagged = (p: PreflightRow) =>
    Math.min(p.imageDpi ?? report.minDpi, p.artDpi ?? report.minDpi) < report.minDpi ||
    (p.inkPct ?? 0) > report.inkLimitPct ||
    Boolean(p.textOutsideSafe?.length);
  const src = (proof?: string) => `${API_BASE}/pages/${pageId}/render.png?width=600${proof ? `&proof=${proof}` : ""}`;
  return (
    <div className="mt-2 space-y-3 text-sm" data-testid="preflight-report">
      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="rounded bg-[var(--panel-2)] px-1.5 py-0.5">
          {report.pageCount} 页{report.evenPageCount ? "" : "（奇数）"}
        </span>
        <span className="rounded bg-[var(--panel-2)] px-1.5 py-0.5">最低 {report.lowestDpi} DPI</span>
        <span className="rounded bg-[var(--panel-2)] px-1.5 py-0.5">最高墨量 {report.maxInkPct}%</span>
        <span className="rounded bg-[var(--panel-2)] px-1.5 py-0.5">{report.fonts.length} 种字体</span>
      </div>
      <PrintIssues issues={report.issues} ok="印前检查通过，无需修正。" />
      {report.fonts.length > 0 && (
        <p className="muted text-xs">
          字体{" "}
          {report.fonts
            .map((f) => `${f.family} (${f.uses}${f.installed === false ? "，未安装" : f.installed ? "，已安装" : ""})`)
            .join(", ")}
        </p>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer">全部页面（{report.pages.length}）</summary>
        <div className="mt-1 max-h-64 overflow-auto">
          <table className="w-full text-left">
            <thead className="muted">
              <tr>
                <th className="pr-2 font-normal">页面</th>
                <th className="pr-2 font-normal">页面 / 原画 DPI</th>
                <th className="pr-2 font-normal">墨量</th>
                <th className="font-normal">打样色偏</th>
              </tr>
            </thead>
            <tbody>
              {report.pages.map((p) => (
                <tr key={p.page} className={flagged(p) ? "text-amber-700 dark:text-amber-300" : ""}>
                  <td className="pr-2">
                    {p.page}
                    {p.kind === "page"
                      ? ` · 第 ${p.chapter} 章，第 ${p.order} 页`
                      : ` · ${{ blank: "空白页", toc: "目录", cover: "封面" }[p.kind] ?? p.kind}`}
                  </td>
                  <td className="pr-2">
                    {p.imageDpi ?? "—"} / {p.artDpi ?? "—"}
                  </td>
                  <td className="pr-2">{p.inkPct === undefined ? "—" : `${p.inkPct}%`}</td>
                  <td>{p.shiftPct === undefined ? "—" : `${p.shiftPct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {pageId && (
        <div className="space-y-2">
          <Field
            label={grey ? "软打样（仅黑色油墨）" : "软打样（CMYK）"}
            hint={grey ? "页面按灰度内页印刷的效果。" : "模拟超出印刷色域的颜色在纸上的偏移，采用通用印刷配置。"}
          >
            <select className="input" value={pageId} onChange={(e) => setPageId(e.target.value)}>
              {pages.map((p) => (
                <option key={p.pageId} value={p.pageId}>
                  第 {p.page} 页（第 {p.chapter} 章，第 {p.order} 页）
                  {p.pageId === report.mostShiftedPage?.pageId ? " — 色偏最大" : ""}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <figure>
              <img className="w-full rounded border border-[var(--border)]" src={src()} alt="页面渲染效果（RGB）" />
              <figcaption className="muted mt-0.5 text-xs">RGB</figcaption>
            </figure>
            <figure>
              <img
                className="w-full rounded border border-[var(--border)]"
                src={src(grey ? "grey" : "cmyk")}
                alt="页面印刷软打样效果"
              />
              <figcaption className="muted mt-0.5 text-xs">{grey ? "黑色油墨" : "CMYK 打样"}</figcaption>
            </figure>
          </div>
        </div>
      )}
    </div>
  );
}
