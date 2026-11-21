/**
 * Production presets: one choice at project creation that sets format, style, quality, runtime and how much gets
 * generated. `settings` is merged into the new project's settings; the rest fills the wizard's own fields.
 */
export type ProductionPreset = {
  key: string;
  name: string;
  description: string;
  projectType: "manga" | "manhwa" | "webtoon" | "comic" | "illustrated_story";
  format: "comic" | "film" | "vertical";
  stylePresetKey: string;
  colorMode: "full_color" | "grayscale" | "bw_manga";
  settings: {
    imageQuality: "low" | "medium" | "high";
    targetRuntime: { minutes: number; wordsPerMinute: number; minShotSeconds: number; maxShotSeconds: number } | null;
    referencePolicy: "all" | "main";
    batchPolicy: "interactive" | "images" | "hybrid" | "cheapest";
  };
};

export const PRODUCTION_PRESETS: ProductionPreset[] = [
  {
    key: "youtube-recap-30",
    name: "YouTube 剧情解说（30 分钟）",
    description: "约 30 分钟的 16:9 旁白视频，带平移和缩放运镜。使用低画质，仅为主要角色生成参考图。",
    projectType: "manhwa",
    format: "film",
    stylePresetKey: "manhwa",
    colorMode: "full_color",
    settings: {
      imageQuality: "low",
      targetRuntime: { minutes: 30, wordsPerMinute: 150, minShotSeconds: 4, maxShotSeconds: 8 },
      referencePolicy: "main",
      batchPolicy: "images",
    },
  },
  {
    key: "youtube-recap-60",
    name: "YouTube 剧情解说（1 小时）",
    description: "30 分钟方案的加长版。镜头更长，图像使用服务商的半价批处理。",
    projectType: "manhwa",
    format: "film",
    stylePresetKey: "manhwa",
    colorMode: "full_color",
    settings: {
      imageQuality: "low",
      targetRuntime: { minutes: 60, wordsPerMinute: 150, minShotSeconds: 5, maxShotSeconds: 10 },
      referencePolicy: "main",
      batchPolicy: "images",
    },
  },
  {
    key: "youtube-recap-120",
    name: "YouTube 剧情解说（2 小时）",
    description: "约 2 小时、20 个章节的长篇解说。镜头长 5–10 秒，仅为主要角色生成参考图，图像批量生成。",
    projectType: "manhwa",
    format: "film",
    stylePresetKey: "manhwa",
    colorMode: "full_color",
    settings: {
      imageQuality: "low",
      targetRuntime: { minutes: 120, wordsPerMinute: 150, minShotSeconds: 5, maxShotSeconds: 10 },
      referencePolicy: "main",
      batchPolicy: "images",
    },
  },
  {
    key: "youtube-recap-180",
    name: "YouTube 剧情解说（3 小时）",
    description:
      "约 3 小时、25 个章节的解说。镜头长 6–12 秒，将图像数量控制在约 1,200 张。仅为主要角色生成参考图，图像批量生成。",
    projectType: "manhwa",
    format: "film",
    stylePresetKey: "manhwa",
    colorMode: "full_color",
    settings: {
      imageQuality: "low",
      targetRuntime: { minutes: 180, wordsPerMinute: 150, minShotSeconds: 6, maxShotSeconds: 12 },
      referencePolicy: "main",
      batchPolicy: "images",
    },
  },
  {
    key: "manga-chapter",
    name: "日式漫画章节",
    description: "从右到左阅读的黑白漫画，每个角色和场景都根据参考图绘制。",
    projectType: "manga",
    format: "comic",
    stylePresetKey: "shonen",
    colorMode: "bw_manga",
    settings: { imageQuality: "medium", targetRuntime: null, referencePolicy: "all", batchPolicy: "interactive" },
  },
  {
    key: "webtoon-episode",
    name: "条漫分集",
    description: "适合手机竖向滚动阅读的彩色条漫，支持边生成边审核。",
    projectType: "webtoon",
    format: "vertical",
    stylePresetKey: "modern-webtoon",
    colorMode: "full_color",
    settings: { imageQuality: "medium", targetRuntime: null, referencePolicy: "all", batchPolicy: "interactive" },
  },
  {
    key: "ai-video-ad",
    name: "AI 视频广告（60 秒，写实）",
    description: "一分钟真人电影风广告。先在「故事」中根据需求写出广告脚本，再将每个 4–6 秒镜头制成视频片段。",
    projectType: "illustrated_story",
    format: "film",
    stylePresetKey: "realistic",
    colorMode: "full_color",
    settings: {
      imageQuality: "low",
      targetRuntime: { minutes: 1, wordsPerMinute: 150, minShotSeconds: 4, maxShotSeconds: 6 },
      referencePolicy: "all",
      batchPolicy: "interactive",
    },
  },
  {
    key: "ai-video-ad-cartoon",
    name: "AI 视频广告（60 秒，卡通）",
    description: "一分钟明快的二维卡通广告。先根据需求写脚本，再将每个镜头制作成动画片段。",
    projectType: "illustrated_story",
    format: "film",
    stylePresetKey: "cartoon",
    colorMode: "full_color",
    settings: {
      imageQuality: "low",
      targetRuntime: { minutes: 1, wordsPerMinute: 150, minShotSeconds: 4, maxShotSeconds: 6 },
      referencePolicy: "all",
      batchPolicy: "interactive",
    },
  },
  {
    key: "ai-video-story",
    name: "AI 视频故事（3 分钟，动漫）",
    description: "带旁白的动漫风格短故事，将镜头制作成动态视频片段。",
    projectType: "manhwa",
    format: "film",
    stylePresetKey: "minimal-anime",
    colorMode: "full_color",
    settings: {
      imageQuality: "low",
      targetRuntime: { minutes: 3, wordsPerMinute: 150, minShotSeconds: 4, maxShotSeconds: 8 },
      referencePolicy: "main",
      batchPolicy: "interactive",
    },
  },
  {
    key: "economy",
    name: "低成本草稿",
    description: "低成本预览完整故事。使用低画质，仅为主要角色生成参考图，将可延后的步骤交给半价批处理。",
    projectType: "manhwa",
    format: "comic",
    stylePresetKey: "manhwa",
    colorMode: "full_color",
    settings: { imageQuality: "low", targetRuntime: null, referencePolicy: "main", batchPolicy: "cheapest" },
  },
];
