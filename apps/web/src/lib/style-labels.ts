import type { StylePresetRow } from "../api/types.ts";

const builtInStyles: Readonly<Record<string, readonly [name: string, summary: string]>> = {
  manhwa: ["韩式漫画", "当代韩式漫画风格，采用精细的数字绘制。"],
  "modern-webtoon": ["现代条漫", "明快的竖向条漫风格，适合在手机上阅读。"],
  shonen: ["少年漫画", "充满动感的日式少年漫画风格。"],
  seinen: ["青年漫画", "成熟、写实的日式青年漫画风格。"],
  shojo: ["少女漫画", "细腻、富有情感的少女漫画风格。"],
  "dark-fantasy": ["黑暗奇幻", "粗粝、阴郁的黑暗奇幻插画。"],
  action: ["动作漫画", "具有强烈视觉冲击力的动作漫画风格。"],
  romance: ["浪漫插画", "柔和、浪漫的插画风格。"],
  horror: ["恐怖漫画", "营造不安氛围的恐怖漫画风格。"],
  "minimal-anime": ["极简动画", "简洁清爽的日式动画风格。"],
  cartoon: ["卡通", "明亮的现代二维卡通风格，适合动画系列和品牌广告。"],
  realistic: ["写实", "照片级真人电影观感，类似电影摄影机拍摄的剧照。"],
};

export function stylePresetText(preset: Pick<StylePresetRow, "key" | "name" | "definition" | "isBuiltin">) {
  const localized =
    preset.isBuiltin && Object.hasOwn(builtInStyles, preset.key) ? builtInStyles[preset.key] : undefined;
  return localized
    ? { name: localized[0], summary: localized[1] }
    : { name: preset.name, summary: preset.definition.summary };
}
