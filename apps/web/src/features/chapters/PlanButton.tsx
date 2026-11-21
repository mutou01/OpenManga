import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, post } from "../../api/client.ts";
import { onProjectEvent, qk } from "../../api/hooks.ts";
import { ConfirmDialog, Spinner, toast } from "../../components/ui.tsx";
import { statusLabel } from "../../lib/locale.ts";
import { AiChip, useAiBody } from "../ai/AiPicker.tsx";

/** Queue chapter planning; asks before replacing existing pages. Shows live planning state. */
export function PlanButton({
  projectId,
  chapterId,
  hasPages,
  label = "规划章节",
}: {
  projectId: string;
  chapterId: string;
  hasPages: boolean;
  label?: string;
}) {
  const qc = useQueryClient();
  const aiText = useAiBody("text");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jobStatus, setJobStatus] = useState<string | null>(null);

  useEffect(() => {
    const off = onProjectEvent((e) => {
      if (e.type !== "job.updated" || e.kind !== "chapter_plan" || e.targetId !== chapterId) return;
      const s = String(e.status);
      if (s === "completed") {
        setJobStatus(null);
        toast.success("章节规划已应用");
        qc.invalidateQueries({ queryKey: qk.chapter(chapterId) });
        qc.invalidateQueries({ queryKey: qk.chapters(projectId) });
      } else if (s === "failed" || s === "cancelled") setJobStatus(null);
      else setJobStatus(s);
    });
    return () => {
      off();
    };
  }, [chapterId, projectId, qc]);

  const run = async (replace: boolean) => {
    setBusy(true);
    try {
      await post(`/chapters/${chapterId}/plan`, { ...aiText(), replace });
      setJobStatus("queued");
      setConfirm(false);
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.status === 409 &&
        !replace &&
        e.code === "conflict" &&
        /already has pages/.test(e.message)
      )
        setConfirm(true);
      else toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const planning = Boolean(jobStatus);
  return (
    <>
      <AiChip cap="text" />
      <button
        type="button"
        className="btn-primary"
        disabled={busy || planning}
        onClick={() => (hasPages ? setConfirm(true) : run(false))}
      >
        {busy || planning ? <Spinner /> : <Sparkles className="size-4" />}
        {planning ? `正在规划（${statusLabel(jobStatus ?? "pending")}）……` : label}
      </button>
      <ConfirmDialog
        open={confirm}
        title="替换现有页面？"
        danger
        confirmLabel="重新规划并替换"
        busy={busy}
        onClose={() => setConfirm(false)}
        onConfirm={() => run(true)}
      >
        本章已有页面。重新规划会删除当前场景、页面、画格和页面文字，已生成的图片会保留在素材库。
      </ConfirmDialog>
    </>
  );
}
