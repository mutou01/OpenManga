import { expect, test } from "bun:test";
import { ProjectSettings } from "@openmanga/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { qk } from "../../api/hooks.ts";
import { LetteringSection, SettingsPage } from "./SettingsPage.tsx";

async function renderSettings(role = "owner", format = "comic", status = "active") {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/projects/$projectId/settings",
    component: SettingsPage,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/projects/studio/settings"] }),
  });
  await router.load();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const settings = ProjectSettings.parse({
    format,
    author: "Original Author",
    narrationStyle: "Keep this style in English",
  });
  client.setQueryData(qk.project("studio"), {
    project: {
      title: "Night Bus",
      description: "Original description",
      language: "en",
      projectType: "manga",
      readingDirection: "rtl",
      colorMode: "bw_manga",
      status,
      settings,
    },
    role,
  });
  client.setQueryData(qk.chapters("studio"), { chapters: [] });
  client.setQueryData(qk.meta, { referenceDefaults: { maxWidth: 192, maxHeight: 288 } });
  client.setQueryData(["tts-status"], { voices: [{ id: "af_heart", name: "Original Voice", language: "en" }] });
  client.setQueryData(["ai-options"], {
    credentials: [],
    models: [],
    defaults: { tts: { provider: "kokoro" }, text: null, image: null },
  });
  client.setQueryData(["layouts"], { layouts: [] });
  client.setQueryData(["project", "studio", "runtime", "null"], { chapters: [], estimatedMinutes: 0 });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  client.clear();
  return html;
}

function expectText(html: string, labels: string[]) {
  const visible = html.replace(/<[^>]*>/g, "");
  for (const label of labels) expect(visible).toContain(label);
}

test("项目设置显示中文常用控件并保留英文作品与枚举值", async () => {
  const html = await renderSettings();
  expectText(html, [
    "项目设置",
    "修改后自动保存",
    "常规",
    "标题",
    "作品语言",
    "项目类型",
    "阅读方向",
    "色彩模式",
    "页面与生成",
    "旁白与条漫",
    "制作",
    "目标时长",
  ]);
  for (const value of [
    "Night Bus",
    "en",
    "manga",
    "rtl",
    "bw_manga",
    "low",
    "af_heart",
    "all",
    "interactive",
    "Original Author",
    "Keep this style in English",
  ])
    expect(html).toContain(`value="${value}"`);
  expect(html).toContain("Original description");
  expect(html).toContain("Original Voice");
  expect(html).toContain('value="low" selected=""');
  expect(html).toContain('value="manga" selected=""');
  expect(html).toContain('value="rtl" selected=""');
  expect(html).toContain('value="bw_manga" selected=""');
});

test("只读项目设置显示中文权限说明并禁用表单", async () => {
  const html = await renderSettings("viewer");
  expectText(html, ["仅可查看"]);
  expect(html).toContain("只有项目所有者可以修改预算");
  expect(html).toContain('<fieldset disabled=""');
  expect(html).not.toContain("危险操作");
});

test("视频项目设置显示中文镜头选项并保留原始画幅", async () => {
  const html = await renderSettings("owner", "film", "archived");
  expectText(html, ["镜头与生成", "镜头画幅", "16:9 横屏", "9:16 竖屏", "取消归档项目", "移至回收站"]);
  expect(html).toContain('value="16:9" selected=""');
  expect(html).toContain('value="9:16"');
});

test("文字默认样式显示中文表头、选项和无障碍标签并保留字体标识", () => {
  const html = renderToStaticMarkup(<LetteringSection value={undefined} onChange={() => {}} />);
  expectText(html, [
    "文字默认样式",
    "恢复内置样式",
    "对话",
    "心理活动",
    "喊话",
    "低语",
    "旁白／说明",
    "系统框",
    "字体",
    "字号",
    "行高",
    "内边距",
    "对齐",
    "拟声词",
    "居中",
  ]);
  expect(html).toContain('aria-label="对话字号"');
  expect(html).toContain('value="center"');
  expect(html).toContain("Comic Neue");
  expect(html).toContain("DejaVu Sans");
});
