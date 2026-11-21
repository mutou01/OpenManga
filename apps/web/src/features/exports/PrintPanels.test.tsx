import { expect, test } from "bun:test";
import { coverLayout, type PrintIssue } from "@openmanga/domain/browser";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { CoverCheck, PreflightReport, type PreflightReportData, PrintIssues } from "./PrintPanels.tsx";

test("印前报告公开界面显示中文并保留字体名称与数值", () => {
  const report: PreflightReportData = {
    pageCount: 3,
    evenPageCount: false,
    inkModel: "CMYK",
    inkLimitPct: 300,
    minDpi: 300,
    lowestDpi: 240,
    maxInkPct: 280,
    mostShiftedPage: null,
    fonts: [{ family: "User Font", uses: 2, installed: false }],
    issues: [],
    pages: [{ page: 1, kind: "page", chapter: 2, order: 1, imageDpi: 240, artDpi: 300 }],
  };
  const html = renderToStaticMarkup(<PreflightReport report={report} grey={false} />);
  expect(html).toContain("3 页（奇数）");
  expect(html).toContain("最低 240 DPI");
  expect(html).toContain("印前检查通过，无需修正。");
  expect(html).toContain("User Font (2，未安装)");
  expect(html).toContain("全部页面（1）");
  expect(html).toContain("页面 / 原画 DPI");
  expect(html).not.toContain("Preflight:");
});

test("网页封面检查翻译原始诊断并保留页数和尺寸", () => {
  const layout = coverLayout({
    trimIn: [6, 9],
    pageCount: 20,
    paper: "white",
    rtl: false,
    title: "User Title",
    author: "User Author",
    description: "User Description",
  });
  const client = new QueryClient();
  client.setQueryData(["print-cover", "studio", "pageSize=kdp_6x9&paper=white&toc=false&rectoChapters=false"], {
    pageCount: 20,
    layout,
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <CoverCheck
        projectId="studio"
        chapterId={null}
        pageSize="kdp_6x9"
        paper="white"
        pageCount=""
        toc={false}
        rectoChapters={false}
      />
    </QueryClientProvider>,
  );
  for (const text of [
    "页数",
    "书脊",
    "含出血的完整封面",
    "20 页",
    "至少 24 页",
    "请先生成或上传项目封面",
    "少于 79 页",
  ])
    expect(html).toContain(text);
  expect(html).toContain("0.045");
  expect(html).toContain("12.295");
  client.clear();
});

test("印前警告翻译固定诊断并保留字体名称与未知内容", () => {
  const issues: PrintIssue[] = [
    {
      code: "low_dpi",
      severity: "warn",
      message: "Page 2, 4 print below 300 DPI (lowest 240). Raise the export scale or use larger art.",
    },
    {
      code: "font_missing",
      severity: "warn",
      message:
        '"User Font" is not installed on the render server, so its lettering was drawn in Comic Neue or DejaVu Sans instead.',
    },
    {
      code: "odd_page_count",
      severity: "info",
      message: "3 pages, an odd count: a printed book adds a blank last page.",
    },
    {
      code: "text_outside_safe",
      severity: "warn",
      message: "Lettering on page 4 reaches outside the safe area and may be trimmed or lost in the binding.",
    },
    {
      code: "fonts_rasterized",
      severity: "info",
      message:
        "The PDF holds page images only: lettering is drawn into the pixels at the page's resolution, so no font needs embedding.",
    },
    { code: "no_cover_art", severity: "block", message: "User diagnostic detail" },
  ];
  const html = renderToStaticMarkup(<PrintIssues issues={issues} ok="通过" />);
  for (const text of [
    "第 2, 4 页",
    "最低 240",
    "User Font",
    "未安装",
    "Comic Neue",
    "DejaVu Sans",
    "3 页为奇数",
    "第 4 页的文字",
    "无需嵌入字体",
    "User diagnostic detail",
  ])
    expect(html).toContain(text);
  expect(html.indexOf("User diagnostic detail")).toBeLessThan(html.indexOf("第 2, 4 页"));
  expect(issues[0]?.code).toBe("low_dpi");
});
