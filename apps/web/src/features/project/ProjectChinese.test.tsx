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
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { qk } from "../../api/hooks.ts";
import { PronunciationSection } from "./PronunciationSection.tsx";
import { KindAges, StorageSection } from "./StorageSection.tsx";

async function renderProject(component: ComponentType, entries: [readonly unknown[], unknown][] = []) {
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path: "/projects/$projectId/test", component });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/projects/studio/test"] }),
  });
  await router.load();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(qk.project("studio"), {
    project: { title: "Night Bus", settings: ProjectSettings.parse({}) },
    role: "owner",
  });
  client.setQueryData(["ai-options"], {
    credentials: [],
    defaults: { text: null, image: null, tts: { provider: "kokoro" } },
  });
  for (const [key, value] of entries) client.setQueryData(key, value);
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

const storage = {
  policy: { enabled: true, maxAgeDays: 30, capGb: 2, kindAges: { export: 7, audio_take: null } },
  use: { bytes: 3 * 1024 ** 3, capBytes: 2 * 1024 ** 3, overCap: true },
  expendable: { export: { files: 3, bytes: 2048 } },
  preview: { files: 3, bytes: 2048, afterBytes: 0, overLimitBytes: 0 },
};

test("存储设置用中文显示用量、清理预览和分类保留策略", async () => {
  const html = await renderProject(
    () => <StorageSection projectId="studio" owner />,
    [[["project", "studio", "storage"], storage]],
  );
  expectText(html, [
    "存储",
    "已超出上限",
    "为此项目启用存储策略",
    "存储上限（GB）",
    "保存存储策略",
    "立即应用",
    "将删除 3 个文件",
    "视频片段缓存",
    "导出文件",
    "旧版分镜画稿",
    "闲置旁白录音",
    "回收站文件",
    "提示词参考副本",
    "跟随通用设置",
    "单独设置天数",
    "不限保留时间",
  ]);
  expect(html).toContain('aria-label="导出文件保留天数"');
  expect(html).toContain('value="7"');
  for (const value of ["default", "never", "days"]) expect(html).toContain(`value="${value}"`);
});

test("非所有者的存储设置禁用操作并显示中文权限与空预览", async () => {
  const html = await renderProject(
    () => <StorageSection projectId="studio" owner={false} />,
    [[["project", "studio", "storage"], { ...storage, preview: { ...storage.preview, files: 0 } }]],
  );
  expect(html).toContain('title="只有项目所有者可以设置"');
  expect(html).toContain('<fieldset disabled=""');
  expectText(html, ["当前没有需要删除的文件"]);
});

test("各类保留期限仍区分继承、无限期和独立天数", () => {
  const html = renderToStaticMarkup(
    <KindAges value={{ export: 7, audio_take: null }} defaultDays={30} expendable={{}} onChange={() => {}} />,
  );
  expectText(html, ["类型", "当前存储", "保留期限"]);
  expect(html).toContain('value="default" selected=""');
  expect(html).toContain('value="never" selected=""');
  expect(html).toContain('value="days" selected=""');
});

test("发音设置汉化操作与无障碍标签并保留用户原词和读音", async () => {
  const html = await renderProject(() => (
    <PronunciationSection
      value={[{ term: "Qi", spoken: "chee", caseSensitive: true, wholeWord: true }]}
      voice="af_heart"
      speed={1}
      onChange={() => {}}
    />
  ));
  expectText(html, ["发音", "区分大小写", "全词匹配", "添加条目"]);
  expect(html).toContain('aria-label="书面词语"');
  expect(html).toContain('aria-label="朗读方式"');
  expect(html).toContain('aria-label="试听 Qi"');
  expect(html).toContain('aria-label="移除 Qi"');
  expect(html).toContain('value="Qi"');
  expect(html).toContain('value="chee"');
});

test.each([false, true])("提示词实验室汉化版本操作，保留规则正文、用户备注和章节标题（图像模式 %s）", async (image) => {
  const { PromptLabPage } = await import("./PromptLabPage.tsx");
  const name = image ? "panel-generation" : "chapter-outline";
  const template = {
    name,
    label: image ? "Panel images: project rules and exclusions" : "Chapter planning: scene outline",
    image,
    builtInVersion: 3,
    builtInRules: "Keep this built-in rule in English.",
    active: {
      id: "v2",
      version: 2,
      rules: "Original project rule: preserve {story}.",
      note: "Original note",
      active: true,
      createdAt: new Date().toISOString(),
    },
    versions: [
      { id: "v2", version: 2, note: "Original note", active: true, createdAt: new Date().toISOString() },
      { id: "v1", version: 1, note: "Earlier note", active: false, createdAt: new Date().toISOString() },
    ],
  };
  const html = await renderProject(PromptLabPage, [
    [
      ["project", "studio", "prompt-lab"],
      { templates: [template, { ...template, name: "future-custom", label: "My custom template", active: null }] },
    ],
    [qk.chapters("studio"), { chapters: [{ id: "chapter-original", order: 1, title: "Original Chapter" }] }],
  ]);
  expectText(html, [
    "提示词实验室",
    "项目规则 v2",
    "内置 v3",
    "预览",
    "另存为 v3 并启用",
    "版本",
    "使用内置版本",
    "使用 v1",
    "使用中",
    "Original note",
    "Earlier note",
    "Original project rule: preserve {story}.",
    "My custom template",
  ]);
  expect(html).toContain('aria-label="提示词列表"');
  expect(html).toContain('placeholder="本版本备注"');
  expect(html).toContain(`aria-label="${image ? "分镜图像的项目规则与排除项" : "章节规划的场景大纲"}"`);
  if (image) {
    expectText(html, ["每个分镜图像提示词附加的项目规则", "选择章节", "Original Chapter"]);
    expect(html).toContain('value="chapter-original"');
  }
});

test("提示词实验室显示内置正文原文与使用中状态", async () => {
  const { PromptLabPage } = await import("./PromptLabPage.tsx");
  const html = await renderProject(PromptLabPage, [
    [
      ["project", "studio", "prompt-lab"],
      {
        templates: [
          {
            name: "narration",
            label: "Narration instructions",
            image: false,
            builtInVersion: 1,
            builtInRules: "Do not translate {story} or model instructions.",
            active: null,
            versions: [],
          },
        ],
      },
    ],
  ]);
  expectText(html, ["旁白指令", "规则", "使用中", "Do not translate {story} or model instructions."]);
});

const costPlan = {
  models: { text: { model: "original-model", free: true }, image: { model: "original-image-model" } },
  project: {
    analysis: { needed: true, usd: null },
    references: { count: 2, estimated: true, usd: 0.5, batched: true },
    thumbnail: { needed: true, usd: 0.1 },
    youtube: { needed: true, usd: 0 },
  },
  chapters: [
    {
      id: "original-chapter",
      order: 1,
      title: "Original Chapter",
      estimated: true,
      panels: 3,
      plan: { needed: true, usd: 0 },
      prompts: { pages: 2, usd: 0.2 },
      art: { panels: 3, usd: 1, batched: true },
      narration: { needed: true, usd: 0 },
      audio: { segments: 2, seconds: 120 },
      storageBytes: 1024,
      usd: 1.2,
    },
  ],
  totals: { usd: 2, nowUsd: 1, batchedUsd: 1, storageBytes: 1024, panelsToDraw: 3, estimatedChapters: 1 },
  budget: { limitUsd: 5, spentUsd: 4, remainingUsd: 1 },
  warnings: ["Original provider warning"],
};

test("费用预估用中文显示批处理、未知价格和章节明细并保留动态内容", async () => {
  const { CostPlan } = await import("./CostPlan.tsx");
  const html = await renderProject(
    () => <CostPlan projectId="studio" body={{ scope: "all" }} />,
    [[["cost-plan", "studio", '{"scope":"all"}'], costPlan]],
  );
  expectText(html, [
    "约",
    "立即执行",
    "半价批处理",
    "待绘制 3 格",
    "预算",
    "按章节查看",
    "章节",
    "规划",
    "提示词",
    "画稿",
    "旁白",
    "音频",
    "合计",
    "分析",
    "参考图",
    "缩略图",
    "YouTube 文案",
    "价格未知",
    "Original Chapter",
    "Original provider warning",
    "2 分钟",
    "手动粘贴文本结果，无费用",
  ]);
  expect(html).toContain('aria-label="费用预估"');
  expect(html).toContain('title="本地配音，不产生费用"');
  expect(html).toContain("$2.00");
});

test("费用预估加载时显示中文等待提示", async () => {
  const { CostPlan } = await import("./CostPlan.tsx");
  const html = await renderProject(() => <CostPlan projectId="studio" body={{}} />);
  expectText(html, ["正在估算本次制作费用"]);
});

test.each(["plan", "narration"] as const)("过期章节的 %s 操作显示中文并保留原标题和数量", async (stage) => {
  const { StaleChapters } = await import("./StaleChapters.tsx");
  const html = await renderProject(() => (
    <StaleChapters
      projectId="studio"
      stage={stage}
      chapters={[
        {
          chapterId: "original-chapter",
          title: "Original Chapter",
          pages: 2,
          panels: 5,
          drawnPanels: 3,
          narrationLines: 4,
        },
      ]}
    />
  ));
  expectText(html, [
    "Original Chapter",
    "保留当前内容",
    stage === "plan" ? "重新规划" : "重写旁白",
    stage === "plan" ? "规划后原文发生变化的章节" : "编写旁白后内容发生变化的章节",
    stage === "plan" ? "2 页，5 格中已绘制 3 格" : "4 句旁白",
  ]);
});

test("过期原因区域使用约定的中文名称并原样展示后端动态文案与跳转", async () => {
  const { WhyStale } = await import("./WhyStale.tsx");
  const html = await renderProject(
    () => <WhyStale projectId="studio" stage="plan" label="分镜规划" />,
    [
      [
        ["project", "studio", "staleness", "why"],
        {
          stages: [
            {
              key: "plan",
              items: [
                {
                  label: "Original Chapter",
                  why: "原文已更新 Original reason",
                  redo: "重新生成规划 Original redo",
                  chapterId: "original-chapter",
                },
              ],
              more: 2,
            },
          ],
        },
      ],
    ],
  );
  expect(html).toContain('aria-label="分镜规划过期原因"');
  expectText(html, [
    "Original Chapter",
    "原文已更新 Original reason",
    "更新后将",
    "重新生成规划 Original redo",
    "另有 2 项",
  ]);
  expect(html).toContain('href="/projects/studio/chapters/original-chapter#source"');
});

test("分镜画稿原因保留页面链接和分镜定位参数", async () => {
  const { WhyStale } = await import("./WhyStale.tsx");
  const html = await renderProject(
    () => <WhyStale projectId="studio" stage="art" label="画稿" />,
    [
      [
        ["project", "studio", "staleness", "why"],
        {
          stages: [
            {
              key: "art",
              items: [
                {
                  label: "第 2 页 · Original Panel",
                  why: "角色外观已修改",
                  redo: "重绘此格",
                  pageId: "original-page",
                  panelId: "original-panel",
                },
              ],
              more: 0,
            },
          ],
        },
      ],
    ],
  );
  expect(html).toContain('aria-label="画稿过期原因"');
  expectText(html, ["Original Panel", "角色外观已修改", "更新后将", "重绘此格"]);
  expect(html).toContain("/projects/studio/pages/original-page?panelId=original-panel");
});

test("没有过期条目时显示中文最新状态", async () => {
  const { WhyStale } = await import("./WhyStale.tsx");
  const html = await renderProject(
    () => <WhyStale projectId="studio" stage="story" label="故事" />,
    [[["project", "studio", "staleness", "why"], { stages: [{ key: "story", items: [], more: 0 }] }]],
  );
  expectText(html, ["已是最新状态"]);
});

test("发布过期提醒汉化动作并直接展示后端原因", async () => {
  const { PublishingFlags } = await import("./StaleChapters.tsx");
  const html = await renderProject(() => (
    <PublishingFlags
      projectId="studio"
      flags={[
        { key: "youtube_text", stale: true, reasons: ["章节列表已修改", "Original reason"] },
        { key: "thumbnail", stale: true, reasons: ["项目标题已修改"] },
      ]}
    />
  ));
  expectText(html, [
    "YouTube 文案可能已过期",
    "缩略图标题可能已过期",
    "重新生成",
    "使用当前标题",
    "保留当前内容",
    "章节列表已修改",
    "Original reason",
    "项目标题已修改",
  ]);
});
