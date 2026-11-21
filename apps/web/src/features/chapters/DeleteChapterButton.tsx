import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { del } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import { ConfirmDialog } from "../../components/ui.tsx";

export function DeleteChapterButton({
  projectId,
  chapter,
  stats,
  onDeleted,
}: {
  projectId: string;
  chapter: { id: string; order: number; title: string };
  stats?: { pages: number; panels: number; narration?: number } | null;
  onDeleted?: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const remove = useAction(() => del(`/chapters/${chapter.id}`), {
    success: `Chapter "${chapter.title}" deleted`,
    onSuccess: async () => {
      setOpen(false);
      qc.removeQueries({ queryKey: qk.chapter(chapter.id) });
      onDeleted?.();
      await qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });
  return (
    <>
      <button
        type="button"
        className="btn-ghost text-red-500"
        onClick={() => setOpen(true)}
        aria-label={`删除第 ${chapter.order} 章`}
        title="删除章节"
      >
        <Trash2 className="size-4" />
      </button>
      <ConfirmDialog
        open={open}
        danger
        busy={remove.isPending}
        title={`删除第 ${chapter.order} 章“${chapter.title}”？`}
        confirmLabel="删除章节"
        onClose={() => setOpen(false)}
        onConfirm={() => remove.mutate()}
      >
        <p>
          此操作会永久删除该章节及其场景、页面、画格、文字和旁白
          {stats
            ? `（${stats.pages} 页、${stats.panels} 个画格${stats.narration !== undefined ? `、${stats.narration} 条旁白` : ""}）`
            : ""}
          。后续章节会重新编号。
        </p>
        <p className="muted mt-2 text-sm">
          生成的图片和音频会保留在素材库。章节中正在进行的生成任务完成或取消后，才可删除该章节。
        </p>
      </ConfirmDialog>
    </>
  );
}
