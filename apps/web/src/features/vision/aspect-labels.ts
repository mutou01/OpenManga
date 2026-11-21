import type { ImageAspectKey } from "@openmanga/schemas";

export const imageAspectLabels: Record<ImageAspectKey, { label: string; hint: string }> = {
  style: { label: "画风", hint: "线条、色彩、明暗与渲染，决定画面的视觉风格" },
  character: { label: "角色", hint: "提取主要人物的外貌，形成角色设定" },
  outfit: { label: "服装", hint: "服饰层次、面料与配件" },
  location: { label: "地点", hint: "主体背后的环境、建筑与空间布局" },
  lighting: { label: "光照与配色", hint: "主光源、阴影表现与画面主要色彩" },
  composition: { label: "构图", hint: "景别、拍摄角度、取景与视线引导" },
  mood: { label: "氛围与基调", hint: "画面传达的情绪及其营造方式" },
  props: { label: "道具与物件", hint: "重要物品、武器与场景陈设" },
  era: { label: "时代与文化", hint: "时代背景、文化环境与相关视觉线索" },
  pose: { label: "姿势与布局", hint: "将草图中人物的姿势、位置和取景转为分镜可用的描述" },
  technique: { label: "媒介与技法", hint: "墨线、水彩、三维、赛璐璐上色、网点与颗粒" },
};

export function imageAspectLabel(key: string): string {
  return imageAspectLabels[key as ImageAspectKey]?.label ?? (key === "overview" ? "概述" : key);
}
