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
import { BiblePage, bibleKey } from "../bible/BiblePage.tsx";
import { TimelinePage } from "../bible/TimelinePage.tsx";
import { ChaptersPage } from "../chapters/ChaptersPage.tsx";
import { StoryPage } from "../story/StoryPage.tsx";
import { WorldPage } from "../world/WorldPage.tsx";
import { CastPage } from "./CastPage.tsx";

test.each([
  ["cast", CastPage, ["角色", "添加角色", "主角", "配角", "Alice Original", "参考图：已审核"]],
  ["world", WorldPage, ["世界", "地点", "道具", "世界笔记", "暂无地点"]],
  ["chapters", ChaptersPage, ["章节", "新建章节", "已绘制 1/2 个画格", "旁白覆盖 50%"]],
  ["bible", BiblePage, ["故事设定集", "事实", "角色状态"]],
  ["timeline", TimelinePage, ["故事时间线", "添加事件"]],
  ["story", StoryPage, ["故事", "保存故事", "故事正文"]],
] as const)("%s 页面展示中文并保留原始数据", async (page, component, labels) => {
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path: `/projects/$projectId/${page}`, component });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [`/projects/studio/${page}`] }),
  });
  await router.load();
  const client = new QueryClient();
  client.setQueryData(qk.project("studio"), {
    project: { title: "Original Title", settings: { format: "comic", worldNotes: "Original notes" } },
    role: "owner",
  });
  client.setQueryData([...qk.cast("studio"), false], {
    characters: [
      {
        id: "alice",
        name: "Alice Original",
        role: "protagonist",
        aliases: [],
        portraitAssetId: null,
        currentVersion: { versionNumber: 1, status: "approved" },
        referenceStatus: "approved",
        appearances: 2,
        staleReferences: 0,
        contentWarnings: 0,
      },
    ],
  });
  client.setQueryData([...qk.locations("studio"), false], { locations: [] });
  client.setQueryData(qk.chapters("studio"), {
    chapters: [
      {
        id: "chapter",
        title: "Original Chapter",
        order: 1,
        hasPlan: true,
        planStatus: "planned",
        stats: { scenes: 1, pages: 1, ready: 1, panels: 2, narration: 1, narratedPanels: 1 },
        sourceLength: 20,
      },
    ],
  });
  client.setQueryData(bibleKey("studio"), { facts: [], states: [], chapters: [], characters: [], extraction: null });
  client.setQueryData(qk.story("studio"), { revisions: [], analyses: [] });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  for (const label of labels) expect(html).toContain(label);
  if (page === "cast") expect(html).toContain('value="protagonist"');
  client.clear();
});
