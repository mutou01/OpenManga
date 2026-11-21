import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
import { BoardPage, boardKey } from "../board/BoardPage.tsx";
import { DescribeHistory } from "../vision/DescribeHistory.tsx";
import { DescribeImagePage } from "../vision/DescribeImagePage.tsx";
import { EdgePicker } from "./EdgePicker.tsx";
import { Directing } from "./editor/Directing.tsx";
import { Effects } from "./editor/Effects.tsx";
import { ImageTools } from "./editor/ImageTools.tsx";
import { LayoutLibrary } from "./LayoutLibrary.tsx";
import { PagesPage } from "./PagesPage.tsx";
import { StoryboardPage } from "./StoryboardPage.tsx";
import { StripReaderPage } from "./StripReader.tsx";

function render(node: ReactNode, client = new QueryClient()) {
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

test("页面布局和边缘选项使用中文，保留布局名称及协议值", () => {
  const client = new QueryClient();
  client.setQueryData(["layouts"], { layouts: [{ id: "custom", name: "My English Layout", frames: [] }] });
  const html = render(
    <>
      <EdgePicker label="边缘" value={{ style: "torn", size: 0.5 }} onChange={() => {}} />
      <LayoutLibrary projectId="studio" value={[]} onChange={() => {}} />
    </>,
    client,
  );
  for (const label of [
    "页面布局",
    "撕纸",
    "深度",
    "My English Layout",
    'value="torn"',
    'aria-label="My English Layout 的名称"',
  ])
    expect(html).toContain(label);
});

async function renderProject(component: () => ReactNode, client: QueryClient) {
  const root = createRootRoute();
  const project = createRoute({ getParentRoute: () => root, path: "/projects/$projectId", component });
  const router = createRouter({
    routeTree: root.addChildren([project]),
    history: createMemoryHistory({ initialEntries: ["/projects/studio"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />, client);
}

test("参考看板翻译表单和描述维度并保留用户备注及目标值", async () => {
  const client = new QueryClient();
  client.setQueryData(boardKey("studio"), {
    items: [{ id: "ref", assetId: "image", note: "My English reference", width: 100, height: 100, described: null }],
  });
  const html = await renderProject(BoardPage, client);
  for (const label of [
    "参考看板",
    "添加图片",
    "描述维度",
    "光照与配色",
    "用作参考图",
    "My English reference",
    'value="character"',
    'value="lighting"',
  ])
    expect(html).toContain(label);
});

test("图片描述页面翻译说明、选项、历史记录及无障碍文案", async () => {
  const client = new QueryClient();
  client.setQueryData(["image-descriptions", "all", "all"], { descriptions: [] });
  const html = await renderProject(DescribeImagePage, client);
  for (const label of [
    "图片描述",
    "提取内容",
    "画风",
    "线条、色彩、明暗与渲染",
    "历史描述",
    "所有项目",
    "描述图片",
    "需要支持视觉输入的模型",
  ])
    expect(html).toContain(label);
});

test("看板状态和描述历史显示中文维度，保留原始模型描述", async () => {
  const client = new QueryClient();
  client.setQueryData(boardKey("studio"), {
    items: [
      {
        id: "ref",
        assetId: "image",
        note: "My English reference",
        width: 100,
        height: 100,
        described: { status: "queued", aspects: ["lighting"], description: null },
      },
    ],
  });
  const board = await renderProject(BoardPage, client);
  expect(board).toContain("正在描述 光照与配色");
  client.setQueryData(["image-descriptions", "all", "all"], {
    descriptions: [
      {
        id: "old",
        projectId: "other",
        projectTitle: "My English project",
        assetId: "image",
        aspects: ["lighting", "style"],
        custom: "My English question",
        createdAt: new Date().toISOString(),
        description: { overview: "Original English model output" },
      },
    ],
  });
  const history = render(<DescribeHistory projectId="studio" onReuse={() => {}} />, client);
  for (const label of [
    "光照与配色、画风",
    "自定义问题",
    "My English project",
    "Original English model output",
    'aria-label="删除此描述"',
  ])
    expect(history).toContain(label);
});

test("页面、故事板与条漫阅读入口显示中文空态", async () => {
  const client = new QueryClient();
  client.setQueryData(qk.chapters("studio"), { chapters: [] });
  expect(await renderProject(PagesPage, client)).toContain("暂无章节");
  expect(await renderProject(StoryboardPage, client)).toContain("故事板");
  expect(await renderProject(StripReaderPage, client)).toContain("阅读");
});

for (const [file, labels] of [
  ["PagesPage.tsx", ["页面", "添加页面", "删除页面", "用 AI 规划章节"]],
  ["StoryboardPage.tsx", ["故事板", "待审核", "检查不一致", "重新生成"]],
  ["PageEditorPage.tsx", ["撤销", "重做", "阅读顺序", "检查器", "对白排版"]],
  ["StripReader.tsx", ["阅读", "暂无可阅读内容", "尚无图片"]],
] as const) {
  test("桌面页面流程文案覆盖 " + file, () => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const label of labels) expect(source).toContain(label);
  });
}

for (const [file, labels] of [
  ["BulkGenerate.tsx", ["仅生成无图片的分镜", "预计费用", "项目预算"]],
  ["Duplicates.tsx", ["近似重复", "扫描项目", "未发现重复"]],
  ["editor/PageTab.tsx", ["保存页面规划", "保存为布局", "应用布局", "页面用途"]],
  ["editor/PromptTab.tsx", ["提示词检查器", "编译后的提示词", "局部重绘", "修改类型"]],
  ["editor/VersionsTab.tsx", ["上传图片", "暂无图片", "启用", "比较版本"]],
] as const) {
  test("桌面工具文案覆盖 " + file, () => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const label of labels) expect(source).toContain(label);
  });
}

for (const [file, labels] of [
  ["editor/PanelTab.tsx", ["分镜形状与边框", "故事节拍", "保存分镜设定", "视频镜头", "替代文本"]],
  ["editor/LetteringTab.tsx", ["对白文本", "气泡类型", "添加气泡", "移开遮挡人脸的气泡", "移除对白排版"]],
] as const) {
  test("桌面工具文案覆盖 " + file, () => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const label of labels) expect(source).toContain(label);
  });
}

test("导演设置和效果翻译枚举标签，保持协议值与角色名", () => {
  const html = render(
    <>
      <Directing value={undefined} figures={[{ id: "hana", name: "Hana English" }]} onChange={() => {}} />
      <Effects panelId="panel" value={null} locked={false} invalidate={[]} />
    </>,
  );
  for (const label of [
    "导演设置",
    "镜头高度",
    "景深",
    "地面",
    "超广角",
    "Hana English",
    "速度线",
    "添加效果",
    'value="ground"',
    'value="ultra-wide"',
    'value="speed"',
  ])
    expect(html).toContain(label);
});

for (const [file, labels] of [
  ["editor/Directing.tsx", ["导演设置", "画面焦点", "朝向"]],
  ["editor/Effects.tsx", ["速度线", "效果", "强度"]],
  ["editor/OutfitPicker.tsx", ["服装", "仅当前分镜", "重置"]],
  ["editor/CoverageSheet.tsx", ["多机位参考图", "重新构图", "添加为新分镜"]],
  ["editor/DescribePose.tsx", ["描述姿势", "使用此姿势", "取消"]],
  ["editor/CompareModels.tsx", ["比较模型", "使用此结果", "服务器默认"]],
] as const) {
  test("桌面工具文案覆盖 " + file, () => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const label of labels) expect(source).toContain(label);
  });
}

test("图片工具保留用户角色名并翻译编辑入口", async () => {
  const client = new QueryClient();
  client.setQueryData(boardKey("studio"), { items: [] });
  const html = await renderProject(
    () => <ImageTools panelId="panel" cast={["Hana English"]} hasArt={true} locked={false} invalidate={[]} />,
    client,
  );
  for (const label of [
    "图片工具",
    "放大 2 倍",
    "提取线稿",
    "修复人脸与细节",
    "扩展画面",
    "Hana English",
    'value="9:16"',
  ])
    expect(html).toContain(label);
});

for (const [file, labels] of [
  ["editor/GuideDrawer.tsx", ["绘制布局引导图", "保存引导图", "橡皮擦", "绘图画布"]],
  ["editor/ImageTools.tsx", ["图片工具", "光照调整", "新表情"]],
  ["editor/MaskEditor.tsx", ["局部重绘", "提交编辑", "画笔大小"]],
  ["editor/ClipPanel.tsx", ["视频片段", "生成片段", "画面文字", "改用静态图片"]],
  ["editor/Canvas.tsx", ["页面画布", "缩小", "放大", "适应页面"]],
  ["editor/shapes.tsx", ["空分镜"]],
] as const) {
  test("桌面工具文案覆盖 " + file, () => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const label of labels) expect(source).toContain(label);
  });
}

test("pages/editor/GuideDrawer.tsx 的辅助文案使用中文", () => {
  const source = readFileSync(new URL("../pages/editor/GuideDrawer.tsx", import.meta.url), "utf8");
  expect(source).toContain("显示下方的");
  expect(source).toContain("拖动关节");
});

test("pages/editor/MaskEditor.tsx 的辅助文案使用中文", () => {
  const source = readFileSync(new URL("../pages/editor/MaskEditor.tsx", import.meta.url), "utf8");
  expect(source).toContain("画笔大小");
  expect(source).toContain("保留当前版本");
});

test("pages/editor/ClipPanel.tsx 的辅助文案使用中文", () => {
  const source = readFileSync(new URL("../pages/editor/ClipPanel.tsx", import.meta.url), "utf8");
  expect(source).toContain("用动态片段替代静态画格");
});

test("pages/BulkGenerate.tsx 的辅助文案使用中文", () => {
  const source = readFileSync(new URL("../pages/BulkGenerate.tsx", import.meta.url), "utf8");
  expect(source).toContain("正在重新估价");
  expect(source).toContain("本批次将超出预算");
});

test("chapters/SceneEditor.tsx 的辅助文案使用中文", () => {
  const source = readFileSync(new URL("../chapters/SceneEditor.tsx", import.meta.url), "utf8");
  expect(source).toContain('placeholder="状态对象"');
  expect(source).toContain("个情节节点");
});

test("chapters/SourceTrace.tsx 的辅助文案使用中文", () => {
  const source = readFileSync(new URL("../chapters/SourceTrace.tsx", import.meta.url), "utf8");
  expect(source).toContain("第 {p.page} 页，第 {p.panel} 格");
});

test("world/WorldPage.tsx 的辅助文案使用中文", () => {
  const source = readFileSync(new URL("../world/WorldPage.tsx", import.meta.url), "utf8");
  expect(source).toContain('stylePresetText(current.preset).name : "自定义"');
});

test("generation/JobDetailPage.tsx 的辅助文案使用中文", () => {
  const source = readFileSync(new URL("../generation/JobDetailPage.tsx", import.meta.url), "utf8");
  expect(source).toContain('?? "失败"');
});

test("内置布局具有中文标题，布局键保持稳定", async () => {
  const { LAYOUT_TEMPLATES } = await import("@openmanga/domain/browser");
  expect(LAYOUT_TEMPLATES.find((layout) => layout.key === "full-page")?.name).toBe("整页单格");
  for (const { name, description } of LAYOUT_TEMPLATES) {
    expect(name).toMatch(/\p{Script=Han}/u);
    expect(description).toMatch(/\p{Script=Han}/u);
  }
});

test("实时通知显示中文提示", () => {
  const source = readFileSync(new URL("../../api/hooks.ts", import.meta.url), "utf8");
  expect(source).toContain("导出已就绪");
  expect(source).toContain("在生成任务中打开");
  expect(source).toContain("你已失去该项目的访问权限");
});

test("故事版本提示显示中文来源", () => {
  const source = readFileSync(new URL("../story/StoryPage.tsx", import.meta.url), "utf8");
  expect(source).toContain('ai_rewrite: "AI 改写"');
  expect(source).toContain("已另存为修订版");
});

test("任务失败与导入提示使用中文", () => {
  const runner = readFileSync(new URL("../../../../worker/src/lib/runner.ts", import.meta.url), "utf8");
  const imports = readFileSync(new URL("../../../../worker/src/handlers/import.ts", import.meta.url), "utf8");
  expect(runner).toContain("已暂停：");
  expect(imports).toContain("OpenManga 项目文件无效");
});
