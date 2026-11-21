import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { qk } from "../../api/hooks.ts";
import { AssetsPage } from "../assets/AssetsPage.tsx";
import { BatchCard, type BatchInfo } from "../generation/BatchStatus.tsx";
import { CheckPanelsButton } from "../generation/CheckPanels.tsx";
import { GenerationPage } from "../generation/GenerationPage.tsx";
import { ManualAnswer } from "../generation/JobDetailPage.tsx";
import { ExportsPage } from "./ExportsPage.tsx";
import { ExportTargetPicker } from "./ExportTargets.tsx";
import { HookVariants } from "./HookVariants.tsx";
import { RepurposePage } from "./RepurposePage.tsx";
import { CaptionsField, ShortsPicker } from "./ShortsPicker.tsx";

async function renderPage(content: ReactNode, seed?: (client: QueryClient) => void) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/projects/$projectId",
    component: () => content,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ["/projects/studio"] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(qk.project("studio"), {
    project: { title: "User Story", language: "en", settings: { format: "comic" }, readingDirection: "ltr" },
  });
  seed?.(client);
  await router.load();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  client.clear();
  return html;
}

test("导出页中文格式选项保留接口枚举", async () => {
  const html = await renderPage(<ExportsPage />, (client) => {
    client.setQueryData(qk.chapters("studio"), { chapters: [] });
    client.setQueryData(qk.exports("studio"), { jobs: [] });
  });
  for (const text of ["导出", "PNG 页面序列", "长条漫画", "YouTube 发布包", "暂无导出", "项目默认（从左到右）"]) {
    expect(html).toContain(text);
  }
  expect(html).toContain('value="webtoon"');
  expect(html).toContain('value="source"');
  expect(html).toContain('value="ltr"');
});

test("素材页中文类型筛选保留接口枚举", async () => {
  const html = await renderPage(<AssetsPage />, (client) => {
    client.setQueryData([...qk.assets("studio"), "trash=0"], {
      assets: [],
      storage: { bytes: 0, variant_bytes: 0 },
      facets: { tags: [], collections: [], models: [] },
    });
  });
  for (const text of ["素材", "收藏", "未使用", "重复文件", "回收站", "角色参考图", "画格原画", "没有匹配的素材"]) {
    expect(html).toContain(text);
  }
  expect(html).toContain('aria-label="素材类型"');
  expect(html).toContain('value="panel_art"');
  expect(html).toContain('value="generated"');
});

test("生成任务页中文状态保留筛选值", async () => {
  const html = await renderPage(<GenerationPage />, (client) => {
    client.setQueryData([...qk.generations("studio"), "", "", 0], { jobs: [], counts: {}, total: 0 });
  });
  for (const text of ["生成任务", "排队中", "处理中", "全部状态", "暂无生成任务"]) expect(html).toContain(text);
  expect(html).toContain('aria-label="按状态筛选"');
  expect(html).toContain('value="awaiting_input"');
});

test("批次卡中文动态提示保留用户章节标题", async () => {
  const batch: BatchInfo = {
    batchId: "batch",
    createdAt: "2026-11-20",
    finishedAt: null,
    state: "queued",
    queuedAhead: 2,
    progress: { total: 3, completed: 0, generating: 0, queued: 3, failed: 0, cancelled: 0 },
    chapters: [{ id: "chapter", title: "User Chapter", order: 1 }],
    pageIds: ["page"],
    pageOrders: [1],
  };
  const html = await renderPage(<BatchCard projectId="studio" batch={batch} />);
  for (const text of ["User Chapter", "第 1 页", "排队中 — 前方还有 2 张图片", "暂停批次", "取消", "详情"]) {
    expect(html).toContain(text);
  }
});

test("手动回答界面中文帮助保留原始错误内容", async () => {
  const html = await renderPage(
    <ManualAnswer
      jobId="manual"
      lastError="User error detail"
      attachments={["image"]}
      answered={1}
      onSubmitted={() => {}}
    />,
  );
  for (const text of [
    "等待你的回答",
    "第 2 个问题",
    "回答应采用什么格式？",
    "提交回答",
    "上传文件",
    "User error detail",
  ]) {
    expect(html).toContain(text);
  }
  expect(html).toContain('alt="图片 1"');
});

test("字幕中文选项保留渲染枚举", () => {
  const html = renderToStaticMarkup(<CaptionsField value="bottom" onChange={() => {}} language="en" />);
  for (const text of ["字幕", "关闭（仅提供 .srt 文件）", "底部简洁字幕", "居中大字字幕", "底部双行字幕"]) {
    expect(html).toContain(text);
  }
  expect(html).toContain('value="two_line"');
  expect(html).toContain('value="bottom" selected');
});

test("网页 PDF 印前控制显示中文并保留尺寸与方向值", async () => {
  const html = await renderPage(<ExportsPage />, (client) => {
    client.setQueryData(qk.chapters("studio"), { chapters: [{ id: "chapter", title: "User Chapter", order: 1 }] });
    client.setQueryData(qk.exports("studio"), { jobs: [] });
  });
  for (const text of [
    "页面尺寸",
    "原始尺寸",
    "美式信纸",
    "单行本",
    "页边距（毫米）",
    "出血（毫米）",
    "阅读方向",
    "章节从右页开始（补充空白页）",
    "目录页",
    "书籍元数据",
    "User Chapter",
  ])
    expect(html).toContain(text);
  expect(html).toContain('value="source" selected');
  expect(html).toContain('value="letter"');
  expect(html).toContain('value="tankobon"');
  expect(html).toContain('value="kdp_6x9"');
  expect(html).toContain('value="rtl"');
});

test("开场变体控制使用中文并保留用户开场及字幕", async () => {
  const html = await renderPage(
    <HookVariants
      projectId="studio"
      video={{
        fadeAtSceneBreaks: false,
        hooks: [
          {
            id: "hook",
            label: "User Hook",
            text: "User narration",
            panelIds: ["panel"],
            title: "User Title",
            thumbnailHeadline: "User Headline",
          },
        ],
      }}
    />,
  );
  for (const text of [
    "开场变体",
    "开场名称",
    "旁白",
    "添加开场",
    "保存开场变体",
    "User Hook",
    "User narration",
    "User Title",
    "User Headline",
  ])
    expect(html).toContain(text);
});

test("内容再利用入口与一致性检查按钮使用中文", async () => {
  const html = await renderPage(
    <>
      <RepurposePage />
      <CheckPanelsButton projectId="studio" scope={{}} />
    </>,
  );
  for (const text of ["内容再利用", "建议方案", "检查全部画格"]) expect(html).toContain(text);
});

test("短视频候选控制保留画格 ID 和用户旁白", async () => {
  const html = await renderPage(
    <ShortsPicker
      projectId="studio"
      chapterId={null}
      language="en"
      minHoldMs={2500}
      lengthSeconds={60}
      onLength={() => {}}
      aspect="9:16"
      value={["panel"]}
      onChange={() => {}}
    />,
    (client) => {
      client.setQueryData(["shorts", "studio", "language=en&minHoldMs=2500&lengthSeconds=60"], {
        shots: [
          {
            id: "panel",
            label: "User Shot",
            shotType: "close",
            artAssetId: null,
            hasArt: true,
            text: "User narration",
            holdMs: 45000,
            score: 1,
            picked: true,
          },
        ],
      });
    },
  );
  for (const text of ["时长（秒）", "自动选择", "预览短视频", "User Shot", "User narration", "特写"])
    expect(html).toContain(text);
  expect(html).toContain('value="60"');
  expect(html).toContain('type="checkbox" checked');
});

test("平台预设用中文说明且保留平台键值", async () => {
  const html = await renderPage(
    <ExportTargetPicker
      projectId="studio"
      kinds={["video_panels", "pdf"]}
      value="youtube"
      onChange={() => {}}
      chapterId={null}
      minHoldMs={2500}
    />,
    (client) => {
      client.setQueryData(["export-target", "studio", "youtube", "minHoldMs=2500"], { issues: [] });
    },
  );
  for (const text of ["目标平台", "平台检查", "YouTube 视频", "章节时间戳", "符合"]) expect(html).toContain(text);
  expect(html).toContain('value="youtube" selected');
  expect(html).toContain('value="kdp_paperback"');
});

test("不支持的字幕语言显示中文原因并继续使用 off", () => {
  const html = renderToStaticMarkup(<CaptionsField value="two_line" onChange={() => {}} language="zh-CN" />);
  expect(html).toContain("尚不支持此旁白语言的字幕");
  expect(html).toContain('value="off" selected');
  expect(html).toContain("disabled");
});

test("导出按钮、进度和语言选项使用中文且保留下载文件名", async () => {
  const html = await renderPage(<ExportsPage />, (client) => {
    client.setQueryData(qk.chapters("studio"), { chapters: [{ id: "chapter", order: 2, title: "User Chapter" }] });
    client.setQueryData(qk.exports("studio"), {
      jobs: [
        {
          id: "export",
          kind: "pdf",
          status: "processing",
          progress: 0.5,
          createdAt: "2026-11-20T08:00:00Z",
          chapter: { id: "chapter", order: 2, title: "User Chapter" },
          files: [{ id: "file", assetId: "asset", fileName: "User Export.pdf", byteSize: 1024 }],
        },
      ],
    });
  });
  for (const text of ["导出进度", "第 2 章", "User Chapter", "User Export.pdf", "中文（普通话）"])
    expect(html).toContain(text);
  expect(html).toMatch(/type="submit"[^>]*>[\s\S]*?导出<\/button>/);
  expect(html).not.toContain("Export progress");
  expect(html).toContain('value="zh"');
});

test("暂停批次继续按钮使用中文并保留提供商原因", async () => {
  const html = await renderPage(
    <BatchCard
      projectId="studio"
      batch={{
        batchId: "paused-batch",
        createdAt: "2026-11-20",
        finishedAt: null,
        state: "paused",
        pauseReason: "Provider user detail",
        queuedAhead: 0,
        progress: { total: 1, completed: 0, generating: 0, queued: 1, failed: 0, cancelled: 0 },
        chapters: [],
        pageIds: [],
        pageOrders: [],
      }}
    />,
  );
  expect(html).toContain("继续");
  expect(html).toContain("Provider user detail");
  expect(html).not.toContain("Resume");
});
