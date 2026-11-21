import { EXPORT_TARGETS, type ExportTarget, exportTarget, type TargetIssue } from "@openmanga/domain/browser";
import { useQuery } from "@tanstack/react-query";
import { get } from "../../api/client.ts";
import { clsx, Field } from "../../components/ui.tsx";

/**
 * A platform target: picking one applies its export settings, shows what a check cannot measure (safe areas, naming,
 * codecs) and checks the platform's limits against this project before exporting. The files are checked again once
 * made (the export's result).
 */
const TARGET_LABELS: Record<string, string> = {
  youtube: "YouTube 视频",
  kdp_paperback: "Amazon KDP 平装书（6×9 英寸）",
  pdf: "PDF（通用阅读器）",
  instagram_carousel: "Instagram 轮播图片",
};
export const exportTargetLabel = (key: string, fallback: string) => TARGET_LABELS[key] ?? fallback;

const TARGET_NOTES: Record<string, string[]> = {
  youtube: [
    "MP4，使用 H.264 视频与 AAC 音频。",
    "章节时间戳至少包含三个章节，每章不少于 10 秒，首章从 0:00 开始。",
    "文字避开底部十分之一区域，播放器控件会遮挡此处。",
  ],
  youtube_shorts: [
    "竖屏 9:16，最长 3 分钟，超过时将作为普通 YouTube 视频上传。",
    "人脸和字幕避开底部五分之一区域与右侧边缘，以免被标题、按钮和评论遮挡。",
  ],
  tiktok: [
    "竖屏 9:16，通过电脑上传时最长 10 分钟。",
    "文字避开底部五分之一区域与右侧边缘，以免被说明、音频和按钮遮挡。",
  ],
  reels: [
    "竖屏 9:16，最长 3 分钟。",
    "列表预览显示画面中间的 3:4 区域，请将主体放在此处，说明文字会遮挡底部五分之一区域。",
  ],
  instagram_carousel: ["最多 20 张图片，每张为 1080×1350（4:5）或 1080×1080，首张作为列表封面。"],
  webtoon_canvas: [
    "JPG 或 PNG，宽 800 像素，高度不超过 1280 像素，单张不超过 2 MB，每话合计不超过 20 MB。",
    "按文件名顺序上传，编号文件名可保持长条漫画的阅读顺序。",
  ],
  tapas: ["JPG，宽 940 像素，与 Tapas 的长条漫画显示宽度一致。", "按文件名顺序上传。"],
  kdp_paperback: [
    "内页采用 300 DPI 满版出血，页数为 24 至 828 页，彩色印刷的页数上限更低，标准彩色为 600 页。",
    "文字距裁切边至少 0.25 英寸，厚书的书脊侧需留更多空间，印前检查会核对此项。",
  ],
  pdf: ["使用页面原始尺寸，无平台限制。"],
};

export function ExportTargetPicker({
  projectId,
  kinds,
  value,
  onChange,
  chapterId,
  minHoldMs,
  durationMs,
}: {
  projectId: string;
  /** The export kinds this page offers. */
  kinds: readonly string[];
  value: string;
  onChange: (t: ExportTarget | null) => void;
  chapterId: string | null;
  minHoldMs: number;
  /** A Shorts cut's chosen length. */
  durationMs?: number;
}) {
  const t = exportTarget(value);
  const params = new URLSearchParams({
    ...(chapterId ? { chapterId } : {}),
    minHoldMs: String(minHoldMs),
    ...(durationMs != null ? { durationMs: String(durationMs) } : {}),
  });
  const check = useQuery({
    queryKey: ["export-target", projectId, value, params.toString()],
    queryFn: () => get<{ issues: TargetIssue[] }>(`/projects/${projectId}/export-targets/${value}/check?${params}`),
    enabled: Boolean(t),
  });
  return (
    <div className="space-y-2">
      <Field label="目标平台" hint="选择平台以应用导出预设，并先检查平台限制。">
        <select className="input" value={value} onChange={(e) => onChange(exportTarget(e.target.value) ?? null)}>
          <option value="">无</option>
          {EXPORT_TARGETS.filter((x) => kinds.includes(x.kind)).map((x) => (
            <option key={x.key} value={x.key}>
              {exportTargetLabel(x.key, x.label)}
            </option>
          ))}
        </select>
      </Field>
      {t && (
        <section aria-label="平台检查" className="space-y-1 rounded-lg border border-[var(--border)] p-2 text-xs">
          <ul className="muted list-disc pl-4">
            {(TARGET_NOTES[t.key] ?? t.notes).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          {check.data &&
            (check.data.issues.length ? (
              <ul className="space-y-0.5">
                {check.data.issues.map((i) => (
                  <li key={i.code} className={clsx(i.level === "block" ? "text-red-600" : "text-amber-600")}>
                    {i.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-emerald-600">
                当前符合 {exportTargetLabel(t.key, t.label)} 的限制，文件生成后会再次检查。
              </p>
            ))}
        </section>
      )}
    </div>
  );
}
