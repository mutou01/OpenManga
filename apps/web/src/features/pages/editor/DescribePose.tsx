import type { ImageDescription } from "@openmanga/schemas";
import { ScanEye } from "lucide-react";
import { useState } from "react";
import { get, post } from "../../../api/client.ts";
import { Field, Modal, Spinner, toast } from "../../../components/ui.tsx";
import { AiChip, useAiBody } from "../../ai/AiPicker.tsx";
import { withPose } from "./guide-draw.ts";

type JobDetail = { job: { status: string; failureReason: string | null; result: unknown } };

/**
 * "Describe pose": a vision job reads the layout guide's poses, placement and framing into one sentence, which is
 * shown for review and only written into the guide's pose text when the user says so, appended or replacing.
 */
export function DescribePose({
  panelId,
  current,
  disabled,
  onApply,
}: {
  panelId: string;
  /** The guide's pose text as it is now. */
  current: string;
  disabled: boolean;
  onApply: (pose: string) => void;
}) {
  const aiText = useAiBody("text");
  const [busy, setBusy] = useState(false);
  const [pose, setPose] = useState<string | null>(null);
  const [mode, setMode] = useState<"append" | "replace">("append");

  const run = async () => {
    setBusy(true);
    try {
      const started = await post<{ job: { id: string } }>(`/panels/${panelId}/guide/describe`, aiText());
      const deadline = Date.now() + 5 * 60_000;
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        const d = await get<JobDetail>(`/generations/${started.job.id}`);
        if (d.job.status === "completed") {
          const p = (d.job.result as { description?: ImageDescription }).description?.pose;
          const text = p?.summary || [...(p?.figures ?? []), p?.framing].filter(Boolean).join("; ");
          if (!text) throw new Error("模型未返回姿势描述");
          setMode(current.trim() ? "append" : "replace");
          setPose(text);
          return;
        }
        // Paste mode: the job waits for an answer on its own page (the app already says where).
        if (d.job.status === "awaiting_input") return;
        if (["failed", "cancelled"].includes(d.job.status)) throw new Error(d.job.failureReason ?? "描述任务未完成");
        if (Date.now() > deadline) throw new Error("任务仍在运行，结果可在生成页面查看");
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={disabled || busy}
          title="视觉模型描述草图中的姿势、位置和取景，经你确认后使用"
          onClick={() => void run()}
        >
          {busy ? <Spinner /> : <ScanEye className="size-3.5" />} 描述姿势
        </button>
        <AiChip cap="text" />
      </span>
      <Modal
        open={pose !== null}
        onClose={() => setPose(null)}
        title="草图中的姿势"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setPose(null)}>
              取消
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!pose?.trim()}
              onClick={() => {
                onApply(withPose(current, pose ?? "", mode));
                setPose(null);
              }}
            >
              使用此姿势
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <Field label="描述（可按需编辑）">
            <textarea className="input" rows={3} value={pose ?? ""} onChange={(e) => setPose(e.target.value)} />
          </Field>
          <fieldset className="space-y-1">
            <legend className="label">姿势文本</legend>
            {(["append", "replace"] as const).map((m) => (
              <label key={m} className="flex items-center gap-2 text-xs">
                <input type="radio" name="pose-mode" checked={mode === m} onChange={() => setMode(m)} />
                {m === "append" ? "追加到已有内容后" : "替换已有内容"}
              </label>
            ))}
          </fieldset>
          <div>
            <div className="label">保存后的姿势文本</div>
            <p className="rounded-lg bg-[var(--panel-2)] p-2 text-xs">{withPose(current, pose ?? "", mode)}</p>
          </div>
        </div>
      </Modal>
    </>
  );
}
