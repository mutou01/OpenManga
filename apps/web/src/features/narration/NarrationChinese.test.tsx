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
import { ChapterPlayer } from "./ChapterPlayer.tsx";
import { EditInWords } from "./EditInWords.tsx";
import { ImportRecording } from "./ImportRecording.tsx";

test("章节播放器使用中文按钮与合成进度", () => {
  const html = renderToStaticMarkup(<ChapterPlayer segments={[]} onCurrent={() => {}} />);
  expect(html).toContain("播放章节");
  expect(html).toContain("已合成");
});

test("旁白录音导入和文字剪辑通过公开界面显示中文", () => {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ImportRecording projectId="studio" chapterId="chapter-1" language="en" />
      <EditInWords projectId="studio" />
    </QueryClientProvider>,
  );
  expect(html).toContain("导入录音");
  expect(html).toContain("用文字剪辑视频");
});

async function renderPage(component: () => ReactNode, client: QueryClient) {
  const route = createRootRoute();
  const page = createRoute({ getParentRoute: () => route, path: "/projects/$projectId", component });
  const router = createRouter({
    routeTree: route.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ["/projects/studio"] }),
  });
  await router.load();
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

test("节奏页面以中文展示时长、问题及修正建议，并保留镜头和旁白原文", async () => {
  const { TimingPage } = await import("./TimingPage.tsx");
  const client = new QueryClient();
  client.setQueryData(["timing", "studio"], {
    chapters: [
      {
        id: "chapter-1",
        order: 1,
        title: "Night Bus",
        shots: 1,
        totalMs: 5000,
        targetMs: 4000,
        audio: { voiced: 1, segments: 1 },
        issues: { long: 1, flash: 1, still: 1, silence: 1 },
      },
    ],
  });
  const effect = { holds: [{ key: "shot-1", beforeMs: 5000, afterMs: 4000 }], deltaMs: -1000 };
  client.setQueryData(["timing", "studio", "chapter-1", null], {
    chapterId: "chapter-1",
    settings: { minHoldMs: 2500, minShotMs: 2000, maxShotMs: 6000, stillMs: 10000, silenceMs: 3000 },
    totalMs: 5000,
    targetMs: 4000,
    audio: { voiced: 1, segments: 1 },
    shots: [
      {
        key: "shot-1",
        label: "My English shot",
        panelId: "panel-1",
        holdMs: 5000,
        narrationMs: 4000,
        joinNext: false,
        minHoldMs: null,
        lines: [{ id: "line-1", text: "Keep this narration.", words: 10 }],
      },
    ],
    issues: [{ kind: "long", key: "shot-1", label: "My English shot", ms: 5000, message: "" }],
    fixes: {
      spread: [{ ...effect, lineId: "line-1", fromKey: "shot-1", untilPanelId: "panel-2", shots: 2 }],
      holds: [{ ...effect, panelId: "panel-1", key: "shot-1", holdMs: 4000, reason: "" }],
      trim: [{ lineId: "line-1", text: "Keep this narration.", words: 10, budget: 8 }],
    },
  });
  const html = await renderPage(TimingPage, client);
  for (const label of [
    "节奏调整",
    "章节",
    "时长",
    "已配音",
    "过长",
    "闪过",
    "静止过久",
    "空白静音",
    "最短停留（秒）",
    "镜头",
    "节奏问题",
    "将长旁白延续到后续镜头",
    "重新平衡停留时长",
    "应用",
    "缩短或扩写旁白",
    'aria-label="改写此行"',
    'aria-label="目标词数"',
    "Night Bus",
    "My English shot",
    "Keep this narration.",
  ])
    expect(html).toContain(label);
});

test("旁白质检显示中文问题分类、严重程度及状态，保留检测原文和协议值", async () => {
  const { NarrationQaPage } = await import("./NarrationQaPage.tsx");
  const client = new QueryClient();
  client.setQueryData(["project", "studio"], { project: { language: "en" } });
  client.setQueryData(["project", "studio", "chapters"], {
    chapters: [{ id: "chapter-1", order: 1, title: "Night Bus" }],
  });
  client.setQueryData(["narration-qa", "studio", "en", "all"], {
    findings: [
      {
        id: "finding-1",
        chapterId: "chapter-1",
        kind: "repeated_opening",
        severity: "high",
        check: "rule",
        status: "open",
        fixable: true,
        message: "Original finding explanation.",
        lineIds: ["line-1"],
        relatedChapterIds: [],
      },
    ],
    audio: [],
    lines: [{ id: "line-1", chapterId: "chapter-1", order: 1, text: "Keep this narration." }],
    counts: { byStatus: { open: 1, ignored: 0, fixed: 0 }, openByKind: { repeated_opening: 1 } },
  });
  const html = await renderPage(NarrationQaPage, client);
  for (const label of [
    "旁白质检",
    "运行检查",
    "AI 检查",
    "检查音频",
    "问题",
    "密度",
    "响度",
    "重复开头",
    "高",
    "规则",
    "待处理",
    "已忽略",
    "已修复",
    'aria-label="选择修复"',
    "修复所选",
    "忽略",
    "Night Bus",
    "Original finding explanation.",
    "Keep this narration.",
    'value="open"',
    'value="ignored"',
    'value="fixed"',
    'value="en"',
  ])
    expect(html).toContain(label);
});

test("旁白页显示中文设置、合成操作与空状态，保留音色和风格内容", async () => {
  const { NarrationPage } = await import("./NarrationPage.tsx");
  const client = new QueryClient();
  client.setQueryData(["project", "studio"], {
    project: {
      language: "en",
      settings: { narrationVoice: "af_heart", narrationStyle: "Keep my prompt style.", narrationSpeed: 1 },
    },
  });
  client.setQueryData(["project", "studio", "chapters"], {
    chapters: [{ id: "chapter-1", order: 1, title: "Night Bus" }],
  });
  client.setQueryData(["tts-status"], {
    enabled: true,
    provider: "kokoro",
    status: { ok: true, state: "ready" },
    voices: [{ id: "af_heart", name: "Heart", language: "en", gender: "female" }],
  });
  client.setQueryData(["chapter", "chapter-1", "narration", "en"], {
    lines: [],
    tracks: [{ language: "en", lines: 1 }],
    defaults: { voice: "af_heart", speed: 1 },
  });
  client.setQueryData(["chapter", "chapter-1", "panels"], { panels: [] });
  const html = await renderPage(NarrationPage, client);
  for (const label of [
    "旁白语言",
    "英语",
    "本地 Kokoro",
    "女声",
    "默认音色",
    "默认语速",
    "试听音色",
    "旁白风格",
    "撰写旁白",
    "重新生成",
    "应用停顿设置",
    "合成所有缺失音频",
    "删除音频",
    "下载音频",
    "旁白质检",
    "暂无旁白",
    "添加旁白行",
    "时间轴清单",
    "导出时间轴 JSON",
    "Night Bus",
    "Heart",
    "Keep my prompt style.",
    'value="af_heart"',
    'value="en"',
  ])
    expect(html).toContain(label);
});

test("旁白行编辑器显示中文操作与音频状态，并保留文本、画格 ID 和音色 ID", async () => {
  const { LineEditor } = await import("./LineEditor.tsx");
  const line = {
    id: "line-1",
    order: 1,
    text: "Keep this narration.",
    panelId: "panel-1",
    showOnPage: false,
    video: {},
    segments: [
      {
        id: "segment-1",
        text: "Original segment.",
        voice: "af_heart",
        speed: null,
        pauseAfterMs: 350,
        audio: null,
        stale: false,
        job: null,
      },
      {
        id: "segment-2",
        text: "Imported segment.",
        voice: null,
        speed: 1,
        pauseAfterMs: 700,
        audio: { assetId: "audio-1", durationMs: 1200, provider: "import" },
        stale: true,
        job: null,
      },
    ],
  } as unknown as Parameters<typeof LineEditor>[0]["line"];
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <LineEditor
        line={line}
        panels={[
          { id: "panel-1", label: "My panel" },
          { id: "panel-2", label: "Next panel" },
        ]}
        voices={[{ id: "af_heart", name: "Heart", language: "en" }]}
        invalidate={[]}
        currentSegmentId={null}
        defaults={{ voice: "af_heart", speed: 1 }}
      />
    </QueryClientProvider>,
  );
  for (const label of [
    'aria-label="关联画格"',
    "无关联画格",
    "在页面显示字幕",
    "重新分段",
    'aria-label="删除旁白行"',
    'aria-label="旁白文字"',
    "视频中",
    "仅当前镜头",
    "开始前停顿",
    "结束后停留",
    'aria-label="片段文字"',
    "无音频",
    "已过期",
    "已导入",
    "语速",
    "停顿",
    "合成",
    "重新生成",
    'aria-label="播放片段"',
    'title="在光标处拆分"',
    'title="与下一片段合并"',
    "Keep this narration.",
    "Original segment.",
    "Imported segment.",
    'value="panel-1"',
    'value="panel-2"',
    'value="af_heart"',
  ])
    expect(html).toContain(label);
});

test("项目旁白合成进度以中文显示排队、合成和失败数量", async () => {
  const { SynthesisProgress } = await import("./SynthesisProgress.tsx");
  const client = new QueryClient();
  client.setQueryData(["narration-progress", "studio", "en"], {
    language: "en",
    chapters: [
      {
        id: "chapter-1",
        order: 1,
        title: "Night Bus",
        lines: 3,
        segments: 5,
        withAudio: 1,
        queued: 2,
        processing: 1,
        failed: 1,
      },
    ],
    totals: { chapters: 1, segments: 5, withAudio: 1, queued: 2, processing: 1, failed: 1 },
  });
  const html = await renderPage(() => <SynthesisProgress projectId="studio" language="en" />, client);
  for (const label of [
    'aria-label="旁白合成进度"',
    "1 章的语音合成",
    "1 / 5 个片段",
    "1 个合成中",
    "2 个排队中",
    "1 个失败",
    "显示全部章节",
    "已有音频的片段",
    "Night Bus",
  ])
    expect(html).toContain(label);
});
