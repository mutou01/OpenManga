import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { type PreviewShot, PreviewVideoButton, VideoPreview } from "./VideoPreview.tsx";

test("视频预览入口显示中文并保留调用方提供的标题", () => {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <PreviewVideoButton projectId="studio" scope={{ chapterId: "chapter-1" }} title="Night Bus" />
    </QueryClientProvider>,
  );
  expect(html).toContain("预览视频");
});

function previewHtml(motion: PreviewShot["motion"], cut: "page" | "panel" = "panel") {
  const client = new QueryClient();
  const shot: PreviewShot = {
    key: "panel-1",
    label: "My English shot",
    motion,
    joinNext: false,
    minHoldMs: null,
    fade: { in: false, out: false },
    page: { id: "page-1", order: 1, chapterId: "chapter-1", chapterOrder: 1, width: 1600, height: 2400, updatedAt: "" },
    panel: {
      id: "panel-1",
      shotType: "close-up",
      frame: { x: 0, y: 0, width: 1, height: 1 },
      aspect: 2 / 3,
      fill: false,
      focus: { x: 0.5, y: 0.5 },
      art: null,
    },
    lines: [
      {
        id: "line-1",
        startOffsetMs: 0,
        endOffsetMs: 0,
        segments: [
          {
            id: "segment-1",
            text: "Keep my English narration.",
            pauseAfterMs: 0,
            audioAssetId: null,
            durationMs: null,
          },
        ],
      },
    ],
  };
  client.setQueryData(["video-preview", `cut=${cut}&aspect=16%3A9&chapterId=chapter-1`], {
    shots: [shot],
    branding: { intro: null, outro: null, chapters: [], watermark: null },
    unplacedLines: 0,
    disabledPanels: 0,
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <VideoPreview
        open
        onClose={() => {}}
        projectId="studio"
        scope={{ chapterId: "chapter-1" }}
        defaultCut={cut}
        title="Night Bus"
      />
    </QueryClientProvider>,
  );
}

test("未指定镜头运动时使用静止协议值并显示中文播放控件", () => {
  const html = previewHtml(null);
  for (const label of ["Night Bus", "My English shot", "Keep my English narration.", 'aria-label="播放"'])
    expect(html).toContain(label);
  expect(html).not.toContain("NaN");
});

test("支持的镜头运动协议值在预览中正常渲染并显示中文名称", () => {
  const labels = {
    static: "静止",
    "push-in": "推进",
    "pull-out": "拉远",
    "pan-left": "向左平移",
    "pan-right": "向右平移",
    "pan-up": "向上平移",
    "pan-down": "向下平移",
  } as const;
  for (const [motion, label] of Object.entries(labels)) {
    const html = previewHtml(motion as PreviewShot["motion"]);
    expect(html).toContain(label);
    expect(html).not.toContain("NaN");
  }
});

test("视频预览以中文显示镜头序号和秒数", () => {
  const html = previewHtml("static");
  expect(html).toContain("镜头 1/1");
  expect(html).toContain("2.5 秒");
});

test("预览设置翻译显示名称并保留画幅、剪辑与取景协议值", () => {
  const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => (key === "om-preview-options" ? "1" : null) },
  });
  try {
    const panel = previewHtml("static");
    for (const label of [
      "画幅",
      "剪辑方式",
      "每画格最短时长（秒）",
      "缩放",
      "渲染最终视频",
      'value="16:9"',
      'value="9:16"',
      'value="1:1"',
      'value="panel"',
      'value="page"',
    ])
      expect(panel).toContain(label);
    const page = previewHtml(null, "page");
    for (const label of ["页面取景", "每页最短时长（秒）", 'value="width"', 'value="scroll"', 'value="height"'])
      expect(page).toContain(label);
  } finally {
    if (storage) Object.defineProperty(globalThis, "localStorage", storage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
