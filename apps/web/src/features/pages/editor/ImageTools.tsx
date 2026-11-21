import { useState } from "react";
import { post } from "../../../api/client.ts";
import { useAction } from "../../../api/hooks.ts";
import { AiChip, useAiBody } from "../../ai/AiPicker.tsx";
import { useBoard } from "../../board/BoardPage.tsx";
import { useProjectId } from "../../project/ProjectLayout.tsx";

/**
 * 图片工具 on the panel's artwork. Quick ones run at once and free; AI ones are masked edits of the whole picture
 * (or of the area outpainting adds). Each makes a new version, so the previous one is a click away in Versions.
 */
export function ImageTools({
  panelId,
  cast,
  hasArt,
  locked,
  invalidate,
}: {
  panelId: string;
  cast: string[];
  hasArt: boolean;
  locked: boolean;
  invalidate: readonly (readonly unknown[])[];
}) {
  const projectId = useProjectId();
  const board = useBoard(projectId);
  const aiImage = useAiBody("image");
  const [palette, setPalette] = useState("");
  const [light, setLight] = useState("");
  const [who, setWho] = useState("");
  const [expression, setExpression] = useState("");
  const [aspect, setAspect] = useState("9:16");
  const run = useAction((body: Record<string, unknown>) => post<{ job?: unknown }>(`/panels/${panelId}/tools`, body), {
    invalidate,
    success: (r) => (r.job ? "编辑已加入队列，生成结果将另存为新版本" : "已完成，当前使用新版本"),
  });
  const ai = (body: Record<string, unknown>) => run.mutate({ ...body, ...aiImage() });
  const off = !hasArt || locked || run.isPending;
  const btn = "btn-secondary px-2 py-1 text-xs";
  return (
    <details className="rounded-lg border border-[var(--border)] p-2">
      <summary className="cursor-pointer text-sm font-medium">图片工具</summary>
      <div className="mt-2 space-y-2 text-xs">
        {!hasArt && <p className="muted">请先绘制画格。</p>}
        <div className="label mb-0">快速处理（免费）</div>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={btn} disabled={off} onClick={() => run.mutate({ tool: "upscale" })}>
            放大 2 倍
          </button>
          <button type="button" className={btn} disabled={off} onClick={() => run.mutate({ tool: "lineart" })}>
            提取线稿
          </button>
        </div>
        {Boolean(board.data?.length) && (
          <div className="flex gap-1">
            <select
              className="input py-1 text-xs"
              aria-label="配色来源"
              value={palette}
              onChange={(e) => setPalette(e.target.value)}
            >
              <option value="">选择看板图片的配色……</option>
              {board.data?.map((b, i) => (
                <option key={b.id} value={b.assetId}>
                  {b.note || `看板图片 ${i + 1}`}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={btn}
              disabled={off || !palette}
              onClick={() => run.mutate({ tool: "palette", paletteAssetId: palette })}
            >
              应用配色
            </button>
          </div>
        )}
        <div className="flex items-center">
          <span className="label mr-auto mb-0">AI 局部编辑</span>
          <AiChip cap="image" />
        </div>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={btn} disabled={off} onClick={() => ai({ tool: "repair" })}>
            修复人脸与细节
          </button>
          <button type="button" className={btn} disabled={off} onClick={() => ai({ tool: "background" })}>
            移除背景
          </button>
          <button type="button" className={btn} disabled={off} onClick={() => ai({ tool: "colorize" })}>
            上色
          </button>
        </div>
        <div className="flex gap-1">
          <input
            className="input py-1 text-xs"
            placeholder="例如：左侧照入温暖的夕阳"
            aria-label="新光照"
            value={light}
            onChange={(e) => setLight(e.target.value)}
          />
          <button
            type="button"
            className={btn}
            disabled={off || light.trim().length < 3}
            onClick={() => ai({ tool: "relight", light })}
          >
            光照调整
          </button>
        </div>
        {cast.length > 0 && (
          <div className="flex gap-1">
            <select
              className="input w-auto py-1 text-xs"
              aria-label="选择要调整表情的角色"
              value={who}
              onChange={(e) => setWho(e.target.value)}
            >
              <option value="">选择角色……</option>
              {cast.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <input
              className="input py-1 text-xs"
              placeholder="例如：疲惫的微笑"
              aria-label="新表情"
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
            />
            <button
              type="button"
              className={btn}
              disabled={off || !who || expression.trim().length < 2}
              onClick={() => ai({ tool: "expression", character: who, expression })}
            >
              更换
            </button>
          </div>
        )}
        <div className="flex gap-1">
          <select
            className="input w-auto py-1 text-xs"
            aria-label="扩图目标比例"
            value={aspect}
            onChange={(e) => setAspect(e.target.value)}
          >
            {["9:16", "16:9", "1:1", "4:5", "2:3"].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <button type="button" className={btn} disabled={off} onClick={() => ai({ tool: "outpaint", aspect })}>
            扩展画面（保留原图内容）
          </button>
        </div>
      </div>
    </details>
  );
}
