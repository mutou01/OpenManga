import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PublishingSection, VideoSection } from "./VideoSettings.tsx";

test("视频设置显示中文控件并保留素材标识和用户标题", () => {
  const html = renderToStaticMarkup(
    <VideoSection
      logoUpload="/projects/studio/video-logo"
      musicUpload="/projects/studio/video-music"
      projectTitle="Night Bus"
      chapters={[{ id: "chapter-1", order: 1, title: "Arrival" }]}
      value={{
        fadeAtSceneBreaks: true,
        watermark: { assetId: "logo-1", corner: "bottom-right", opacity: 0.8, size: 0.12 },
        intro: { title: "Night Bus", subtitle: "Original subtitle", durationMs: 3000 },
      }}
      onChange={() => {}}
    />,
  );
  for (const label of ["视频", "标志水印", "背景音乐", "片头卡", "导出画幅", "导出分辨率", "右下角"]) {
    expect(html).toContain(label);
  }
  expect(html).toContain('value="bottom-right"');
  expect(html).toContain('value="Night Bus"');
  expect(html).toContain('value="Original subtitle"');
  expect(html).toContain('aria-label="片头卡标题"');
});

test("发布设置翻译表单说明并保留用户规则和模板占位符", () => {
  const html = renderToStaticMarkup(
    <PublishingSection
      value={{ youtubeRules: { titleRules: "Keep English", descriptionTemplate: "{hook}\n{summary}", tags: [] } }}
      onChange={() => {}}
    />,
  );
  for (const label of [
    "缩略图与 YouTube 文案",
    "标题规则",
    "描述模板",
    "默认标签",
    "Keep English",
    "{hook}",
    "{summary}",
  ]) {
    expect(html).toContain(label);
  }
});
