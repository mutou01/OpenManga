import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Brush, Eye, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { assetUrl, get, patch, post } from "../../../api/client.ts";
import { qk, useAction, useMeta } from "../../../api/hooks.ts";
import type { EditorPanel, PageDocument, PromptPreview } from "../../../api/types.ts";
import { ErrorBox, Field, KeyValue, Modal, Spinner, StatusChip } from "../../../components/ui.tsx";
import { AiChip, useAiBody } from "../../ai/AiPicker.tsx";
import { useProjectId } from "../../project/ProjectLayout.tsx";
import { MaskEditor } from "./MaskEditor.tsx";

const OPERATIONS = [
  ["change_expression", "改变表情"],
  ["change_pose", "改变姿势"],
  ["change_camera", "改变机位"],
  ["change_background", "改变背景"],
  ["change_outfit", "更换服装"],
  ["remove_object", "移除物体"],
  ["add_object", "添加物体"],
  ["reframe", "调整构图"],
] as const;

/** The picked image key as query params, so the preview reports the model this user's run would use. */
function previewQuery(body: ReturnType<ReturnType<typeof useAiBody>>) {
  const ai = (body as { ai?: { credentialId: string | null; model: string | null } }).ai;
  const p = new URLSearchParams();
  if (ai?.credentialId) p.set("credentialId", ai.credentialId);
  if (ai?.model) p.set("model", ai.model);
  return p.toString();
}

export function PromptInspector({ panelId, open, onClose }: { panelId: string; open: boolean; onClose: () => void }) {
  const { data: meta } = useMeta();
  const qs = previewQuery(useAiBody("image")());
  const q = useQuery({
    queryKey: ["prompt-preview", panelId, qs],
    queryFn: () => get<PromptPreview>(`/panels/${panelId}/prompt-preview${qs ? `?${qs}` : ""}`),
    enabled: open,
  });
  const d = q.data;
  return (
    <Modal open={open} onClose={onClose} title="提示词检查器" wide="xl">
      {q.isLoading && <Spinner />}
      <ErrorBox error={q.error} />
      {d && (
        <div className="grid gap-4 md:grid-cols-[1fr_18rem]">
          <div className="min-w-0">
            <div className="label">
              编译后的提示词 {d.usesOverride && <StatusChip status="prompt-ready" label="已手动覆盖" />}
            </div>
            <pre className="max-h-[55vh] overflow-auto rounded-lg bg-[var(--panel-2)] p-3 text-xs whitespace-pre-wrap">
              {d.compiledPrompt}
            </pre>
          </div>
          <div className="space-y-3 text-sm">
            <KeyValue
              items={[
                ["模板", `${d.template.name} v${d.template.version}`],
                ["模型", [d.provider, d.model].filter(Boolean).join(" · ") || "no key selected"],
                ["画质", d.quality],
                ["宽高比", `${d.aspectRatio.toFixed(2)} : 1`],
                [
                  "角色",
                  d.characters
                    .map((c) => `${c.name} v${c.versionNumber}${c.hasReference ? "" : "（无已审核参考图）"}`)
                    .join(", ") || "none",
                ],
              ]}
            />
            <div>
              <div className="label">参考图片（{d.references.length})</div>
              <p className="muted mb-2 text-xs">
                标准参考图保留完整分辨率，请求发送小尺寸缓存副本（约
                {meta?.referenceDefaults.maxWidth ?? 192}×{meta?.referenceDefaults.maxHeight ?? 288}
                ，按比例缩放以适应边界）。布局引导图使用最长边 1024 像素的无损 PNG，以保留姿势的细线条。
              </p>
              <ul className="space-y-2">
                {d.references.map((r) => (
                  <li key={`${r.index}-${r.assetId}`} className="flex items-center gap-2">
                    <img
                      src={assetUrl(r.assetId, "thumbnail")}
                      alt={r.label}
                      className="size-12 rounded object-cover"
                    />
                    <div className="min-w-0 text-xs">
                      <div className="font-medium">
                        #{r.index} {r.label}
                      </div>
                      <div className="muted">
                        {r.role.replace("_", " ")} · 原始参考图 {r.canonicalWidth}×{r.canonicalHeight}
                      </div>
                    </div>
                  </li>
                ))}
                {!d.references.length && <li className="muted text-xs">本分镜没有可用的已审核参考图。</li>}
              </ul>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function PromptTab({ data, panel }: { data: PageDocument; panel: EditorPanel }) {
  const projectId = useProjectId();
  const [override, setOverride] = useState(panel.promptOverride ?? "");
  const [op, setOp] = useState<(typeof OPERATIONS)[number][0]>("change_expression");
  const [instruction, setInstruction] = useState("");
  const [inspect, setInspect] = useState(false);
  const [masking, setMasking] = useState(false);
  useEffect(() => setOverride(panel.promptOverride ?? ""), [panel.id, panel.promptOverride]);
  const inv = [qk.page(data.page.id), qk.panel(panel.id), qk.generations(projectId), ["prompt-preview", panel.id]];
  const locked = panel.approvalStatus === "locked";
  const busy = panel.status === "queued" || panel.status === "generating";

  const saveOverride = useAction((v: string | null) => patch(`/panels/${panel.id}`, { promptOverride: v }), {
    invalidate: inv,
    success: "已保存提示词",
  });
  const aiImage = useAiBody("image");
  const aiText = useAiBody("text");
  const generate = useAction(
    (body: Record<string, unknown>) => post(`/panels/${panel.id}/generate`, { ...aiImage(), ...body }),
    {
      invalidate: inv,
      success: "生成任务已加入队列",
    },
  );
  const prepare = useAction(() => post(`/pages/${data.page.id}/prepare-prompts`, aiText()), {
    invalidate: [qk.generations(projectId)],
    success: "本页提示词准备任务已加入队列",
  });
  const loadCompiled = async () => {
    const p = await get<PromptPreview>(`/panels/${panel.id}/prompt-preview`);
    setOverride(p.generatedPrompt);
  };

  return (
    <div className="space-y-4 text-sm">
      {panel.latestJob && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] p-2 text-xs">
          <div className="min-w-0">
            <StatusChip status={panel.latestJob.status} />{" "}
            <span className="muted">{panel.latestJob.kind.replace("_", " ")}</span>
            {panel.latestJob.failureReason && <div className="mt-1 text-red-500">{panel.latestJob.failureReason}</div>}
          </div>
          <Link
            to="/projects/$projectId/generation/$jobId"
            params={{ projectId, jobId: panel.latestJob.id }}
            className="btn-ghost text-xs"
          >
            查看
          </Link>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-1">
        <AiChip cap="image" />
        <AiChip cap="text" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={locked || busy || generate.isPending}
          onClick={() => generate.mutate({ operation: "same_prompt" })}
        >
          <Sparkles className="size-4" /> {panel.artwork ? "重新生成" : "生成"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setInspect(true)}>
          <Eye className="size-4" /> 检查提示词
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={!panel.artwork || locked || busy}
          onClick={() => setMasking(true)}
        >
          <Brush className="size-4" /> 局部重绘
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={prepare.isPending}
          onClick={() => prepare.mutate()}
          title="由文本模型为本页每个分镜编写描述性提示词"
        >
          <Wand2 className="size-4" /> 准备本页提示词
        </button>
      </div>

      <div className="space-y-2 rounded-lg border border-[var(--border)] p-2">
        <div className="label">修改后重新生成</div>
        <select className="input" aria-label="修改类型" value={op} onChange={(e) => setOp(e.target.value as typeof op)}>
          {OPERATIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input
          className="input"
          aria-label="修改说明"
          placeholder="例如，让他显得非常愤怒"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
        <button
          type="button"
          className="btn-secondary w-full"
          disabled={!instruction.trim() || locked || busy}
          onClick={() => generate.mutate({ operation: op, instruction }, { onSuccess: () => setInstruction("") })}
        >
          <RefreshCw className="size-4" /> 按修改重新生成
        </button>
      </div>

      <Field
        label="自定义提示词（替代编译后的提示词）"
        hint={panel.promptOverride ? "本分镜正在使用自定义提示词。" : "留空时，根据分镜结构化设定自动编译。"}
      >
        <textarea
          className="input font-mono text-xs"
          rows={10}
          value={override}
          onChange={(e) => setOverride(e.target.value)}
          disabled={locked}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost text-xs" onClick={() => void loadCompiled()} disabled={locked}>
          载入编译后的提示词
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={locked || saveOverride.isPending}
          onClick={() => saveOverride.mutate(override.trim() ? override : null)}
        >
          保存
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={locked || !panel.promptOverride}
          onClick={() => {
            setOverride("");
            saveOverride.mutate(null);
          }}
        >
          清空
        </button>
        <button
          type="button"
          className="btn-primary ml-auto"
          disabled={!override.trim() || locked || busy}
          onClick={() => generate.mutate({ operation: "edited_prompt", promptOverride: override })}
        >
          使用编辑后的提示词重新生成
        </button>
      </div>
      <PromptInspector panelId={panel.id} open={inspect} onClose={() => setInspect(false)} />
      {masking && panel.artwork && (
        <MaskEditor
          panelId={panel.id}
          artworkId={panel.artwork.id}
          pageId={data.page.id}
          onClose={() => setMasking(false)}
        />
      )}
    </div>
  );
}
