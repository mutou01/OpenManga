import { expect, test } from "bun:test";
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
import { ProjectLayout } from "./ProjectLayout.tsx";

test.each([
  ["comic", "页面"],
  ["film", "镜头"],
  ["vertical", "长条漫画"],
])("uses Chinese navigation for a %s project", async (format, expectedPages) => {
  const root = createRootRoute();
  const project = createRoute({
    getParentRoute: () => root,
    path: "/projects/$projectId",
    component: ProjectLayout,
  });
  const router = createRouter({
    routeTree: root.addChildren([project]),
    history: createMemoryHistory({ initialEntries: ["/projects/studio"] }),
  });
  await router.load();
  const client = new QueryClient();
  client.setQueryData(qk.project("studio"), {
    project: { title: "Night Bus", projectType: "comic", readingDirection: "ltr", settings: { format } },
    role: "owner",
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  expect(html).toContain('aria-label="项目导航"');
  expect(html).toContain('placeholder="搜索项目…"');
  expect(html).toContain("Night Bus");
  for (const label of [
    "概览",
    "项目检查",
    "故事",
    "角色",
    "世界设定",
    "参考看板",
    "故事设定集",
    "故事时间线",
    "章节",
    expectedPages,
    "分镜",
    "评论",
    "智能体",
    "生成任务",
    "提示词实验室",
    "旁白",
    "时间轴",
    "图片描述",
    "素材",
    "导出",
    "内容再利用",
    "YouTube 数据",
    "费用",
    "设置",
  ]) {
    expect(html).toContain(` ${label}</a>`);
  }
});
