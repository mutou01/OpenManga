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
import type { UsageSummary } from "../../api/types.ts";
import { CommentBadge, CommentText, Source } from "../comments/comments.tsx";
import { ChannelProfilesPage } from "../profiles/ChannelProfilesPage.tsx";
import { SeriesReaderPage } from "../reader/SeriesReaderPage.tsx";
import { SeriesListPage } from "../series/SeriesPage.tsx";
import { YoutubeChannels } from "../youtube/YoutubePage.tsx";
import { UsageDashboard } from "./UsageDashboard.tsx";
import { UsagePage } from "./UsagePage.tsx";

const usage = {
  windows: {
    today: { calls: 2, costUsd: 1 },
    "7d": { calls: 2, costUsd: 1 },
    "30d": { calls: 2, costUsd: 1 },
    lifetime: { calls: 2, costUsd: 1 },
  },
  breakdown: { imagesUsd: 1, textUsd: 0, mockUsd: 0, byProvider: { openai: 1 } },
  unpricedCalls: 1,
  daily: [],
  operations: [
    { operation: "panel_generation", label: "Panel generation", calls: 2, cost: 1, avg_latency: 100, failures: 0 },
  ],
  providers: [],
  referenceExperiments: [],
  quality: { generatedPanels: 2, regenerationRate: 0, acceptanceRate: 1 },
} as UsageSummary;

function Channels() {
  return <YoutubeChannels returnTo="/settings" />;
}
function Comments() {
  return (
    <>
      <Source viaAgent={false} agentName={null} />
      <Source viaAgent agentName="Original Agent" />
      <CommentBadge n={2} />
      <CommentText body="Original comment @author" />
    </>
  );
}
function Dashboard() {
  return <UsageDashboard data={usage} />;
}

test.each([
  ["/series", "/series", SeriesListPage, ["系列", "新建系列", "频道配置", "Original series", "2 集"]],
  ["/usage", "/usage", UsagePage, ["API 用量与费用", "今天", "最近 30 天"]],
  ["/profiles", "/profiles", ChannelProfilesPage, ["频道配置", "新建配置", "Original profile"]],
  ["/channels", "/channels", Channels, ["YouTube 频道", "连接频道", "连接频道仅授权读取", "Original channel"]],
  ["/s/$slug", "/s/original", SeriesReaderPage, ["第 1 集", "阅读", "Original episode"]],
  ["/comments", "/comments", Comments, ["手动编写", "Original comment", "Original Agent"]],
  ["/dashboard", "/dashboard", Dashboard, ["每日费用", "按操作统计", "画格生成", "1 次调用无法计价"]],
] as const)("以中文展示 %s 并保留用户内容", async (path, url, component, labels) => {
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path, component });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await router.load();
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(["series"], {
    series: [{ id: "original", title: "Original series", description: "Original description", episodes: 2 }],
  });
  client.setQueryData(["channel-profiles"], {
    profiles: [
      { id: "original", name: "Original profile", description: "Original description", preset: null, settings: {} },
    ],
  });
  client.setQueryData(["production-presets"], { presets: [], templates: [] });
  client.setQueryData(["me"], null);
  client.setQueryData(["usage", "me"], usage);
  client.setQueryData(["youtube", "channels"], {
    enabled: true,
    mock: false,
    channels: [{ id: "original", title: "Original channel", status: "active", reportingReady: true }],
  });
  client.setQueryData(["public-series", "original"], {
    series: {
      title: "Original series",
      description: "Original description",
      readingDirection: "ltr",
      cover: null,
      links: { feed: "/api/original.xml" },
    },
    languages: ["en", "zh"],
    episodes: [
      {
        title: "Original episode",
        number: 1,
        chapters: [{ id: "chapter", title: "Original chapter", order: 1, available: true }],
      },
    ],
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const text = html.replace(/<[^>]*>/g, "");
  for (const label of labels) expect(text).toContain(label);
  if (component === SeriesReaderPage) {
    expect(html).toContain('value="en"');
    expect(html).toContain('aria-label="语言"');
    expect(html).toContain('href="/api/original.xml"');
  }
  if (component === Comments) {
    expect(html).toContain('title="2 条待处理评论"');
    expect(html).toContain('title="通过你的连接');
  }
  client.clear();
});
