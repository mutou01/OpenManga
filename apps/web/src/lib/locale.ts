export const UI_LOCALE = "zh-CN";

export const KIND_LABELS: Record<string, string> = {
  story_analysis: "故事分析",
  story_rewrite: "故事改写",
  chapter_plan: "章节规划",
  page_prompts: "准备提示词",
  narration_text: "旁白文本",
  narration_lint: "旁白质检",
  narration_fix: "修正旁白",
  audio_check: "音频检查",
  narration_import: "导入旁白",
  story_coverage: "故事覆盖检查",
  narration_retime: "旁白计时",
  social_copy: "社交平台文案",
  character_reference: "角色参考图",
  location_reference: "场景参考图",
  prop_reference: "道具参考图",
  style_reference: "画风参考图",
  panel_generation: "画格",
  panel_edit: "编辑画格",
  cover: "封面",
  coverage_sheet: "补充镜头表",
  duplicate_scan: "重复检查",
  thumbnail: "视频缩略图",
  youtube_package: "YouTube 发布包",
  expert_extract: "专家操作",
  bible_extract: "提取故事设定",
  timeline_extract: "提取时间线",
  lettering_translate: "翻译排字",
  video_edit: "视频编辑",
  continuity_check: "连贯性检查",
};

const projectTypes: Readonly<Record<string, string>> = {
  manhwa: "韩式漫画",
  manga: "日式漫画",
  webtoon: "条漫",
  comic: "漫画",
  illustrated_story: "插画故事",
};

const readingDirections: Readonly<Record<string, string>> = {
  ltr: "从左到右",
  rtl: "从右到左",
  vertical: "竖向阅读",
};

const formats: Readonly<Record<string, string>> = {
  comic: "分页漫画",
  vertical: "竖向滚动（条漫）",
  film: "横屏旁白视频（16:9）",
  "film-9:16": "竖屏旁白视频（9:16）",
};

const colorModes: Readonly<Record<string, string>> = {
  full_color: "彩色",
  grayscale: "灰度",
  bw_manga: "黑白漫画",
};

const statuses: Readonly<Record<string, string>> = {
  active: "使用中",
  archived: "已归档",
  applied: "已应用",
  approved: "已审核",
  awaiting_input: "等待输入",
  cancelled: "已取消",
  cancel_requested: "正在取消",
  completed: "已完成",
  completed_with_warnings: "已完成，有待处理事项",
  disabled: "已停用",
  done: "已完成",
  draft: "草稿",
  failed: "失败",
  generating: "正在生成",
  locked: "已锁定",
  none: "无",
  paused: "已暂停",
  pending: "待处理",
  planned: "已规划",
  processing: "处理中",
  "prompt-ready": "提示词已就绪",
  queued: "排队中",
  ready: "已就绪",
  review: "待审核",
  running: "运行中",
  skipped: "已跳过",
  submitted: "批处理中",
  superseded: "已替换",
  waiting: "等待中",
};

function labelFor(labels: Readonly<Record<string, string>>, code: string) {
  const translated = Object.hasOwn(labels, code) ? labels[code] : undefined;
  return translated ?? code.replaceAll("_", " ");
}

export const projectTypeLabel = (type: string) => labelFor(projectTypes, type);
export const readingDirectionLabel = (direction: string) => labelFor(readingDirections, direction);
export const formatLabel = (format: string) => labelFor(formats, format);
export const colorModeLabel = (mode: string) => labelFor(colorModes, mode);
export const statusLabel = (status: string) => labelFor(statuses, status);
export const kindLabel = (kind: string) => labelFor(KIND_LABELS, kind);
