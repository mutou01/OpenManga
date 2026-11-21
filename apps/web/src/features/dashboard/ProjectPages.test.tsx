import { expect, test } from "bun:test";
import { PRODUCTION_PRESETS } from "@openmanga/domain/browser";
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
import type { StoryAnalysisRow } from "../../api/types.ts";
import { HealthPage } from "../project/HealthPage.tsx";
import { OverviewPage } from "../project/OverviewPage.tsx";
import { AnalysisReview } from "../story/AnalysisReview.tsx";
import { DashboardPage } from "./DashboardPage.tsx";
import { NewProjectWizard } from "./NewProjectWizard.tsx";

function ReviewPage() {
  const analysis = {
    id: "analysis",
    status: "completed",
    result: {
      summary: "Original summary",
      themes: [],
      visualMotifs: [],
      world: { worldRules: [] },
      characters: [],
      locations: [],
      props: [],
      chapters: [],
      plotBeats: [],
    },
  } as StoryAnalysisRow;
  return <AnalysisReview projectId="studio" analysis={analysis} />;
}

test.each([
  ["/", "/", DashboardPage, ["新建项目", "导入项目", "回收站"]],
  [
    "/projects/new",
    "/projects/new",
    NewProjectWizard,
    ["新建项目", "作品语言", "下一步", "日式漫画章节", "黑暗奇幻", "My own art style"],
  ],
  [
    "/projects/$projectId",
    "/projects/studio",
    OverviewPage,
    ["制作流程", "生成封面", "成员", "一键制作", "应用频道配置", "Night Bus"],
  ],
  ["/projects/$projectId/health", "/projects/studio/health", HealthPage, ["项目检查", "可发布", "磁盘占用"]],
  ["/review", "/review", ReviewPage, ["保存修改", "应用到项目", "摘要", "Original summary"]],
] as const)("renders Chinese project actions on %s", async (path, url, component, labels) => {
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path, component });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await router.load();
  const client = new QueryClient();
  client.setQueryData(qk.project("studio"), {
    project: {
      title: "Night Bus",
      projectType: "comic",
      readingDirection: "ltr",
      colorMode: "full_color",
      settings: { format: "comic" },
    },
    counts: {},
    role: "owner",
  });
  client.setQueryData([...qk.generations("studio"), "recent"], {
    jobs: [{ id: "analysis", kind: "story_analysis", status: "completed" }],
  });
  client.setQueryData(["production-presets"], { presets: PRODUCTION_PRESETS, templates: [] });
  client.setQueryData(["project", "studio", "health"], {
    verdict: { ready: true, blocking: 0 },
    items: [],
    spend: { usd: 0, budgetUsd: null },
    disk: { totalBytes: 0 },
  });
  client.setQueryData(["style-presets"], {
    presets: [
      { id: "builtin", key: "dark-fantasy", name: "Dark Fantasy", isBuiltin: true, definition: { summary: "" } },
      { id: "custom", key: "custom", name: "My own art style", isBuiltin: false, definition: { summary: "" } },
    ],
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const visibleText = html.replace(/<[^>]*>/g, "");
  for (const label of labels) expect(visibleText).toContain(label);
  if (component === NewProjectWizard) expect(html).toContain('value="en"');
  if (component === OverviewPage) {
    const chips = Array.from(html.matchAll(/<span[^>]*>([^<]*)<\/span>/g), (match) => match[1]);
    expect(chips).toContain("故事分析");
    expect(chips).toContain("已完成");
  }
});
