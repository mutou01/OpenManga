import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { get, patch, post } from "../../api/client.ts";
import { ConfirmDialog, toast } from "../../components/ui.tsx";
import { useAiBody } from "../ai/AiPicker.tsx";
import { useProject } from "./ProjectLayout.tsx";

export type StaleChapter = {
  chapterId: string;
  title: string;
  pages: number;
  panels: number;
  drawnPanels: number;
  narrationLines: number;
};
export type Staleness = {
  stages: { key: string; count: number; note: string }[];
  stalePlans: StaleChapter[];
  staleNarration: StaleChapter[];
  /** The YouTube text and the thumbnail headline: flagged, never regenerated on their own. */
  publishing: { key: "youtube_text" | "thumbnail"; stale: boolean; reasons: string[] }[];
};

/** The project's staleness report; every query under this key prefix is refreshed after a decision. */
export const useStaleness = (projectId: string, extra?: unknown) =>
  useQuery({
    queryKey: ["project", projectId, "staleness", extra],
    queryFn: () => get<Staleness>(`/projects/${projectId}/staleness`),
  });

/**
 * Chapters whose plan (or narration) was made from text that has changed since, with the choice for each: keep it
 * as it is, or redo it. Redoing replaces work, so it says how much and asks first; nothing is redone on its own.
 */
export function StaleChapters({
  projectId,
  stage,
  chapters,
}: {
  projectId: string;
  stage: "plan" | "narration";
  chapters: StaleChapter[];
}) {
  const qc = useQueryClient();
  const aiText = useAiBody("text");
  const [busy, setBusy] = useState<string | null>(null);
  const [redo, setRedo] = useState<StaleChapter | null>(null);
  const done = () => qc.invalidateQueries({ queryKey: ["project", projectId, "staleness"] });
  const keep = async (c: StaleChapter) => {
    setBusy(c.chapterId);
    try {
      await post(`/chapters/${c.chapterId}/keep`, { stage });
      await done();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const redoIt = async (c: StaleChapter) => {
    setBusy(c.chapterId);
    try {
      await post(stage === "plan" ? `/chapters/${c.chapterId}/plan` : `/chapters/${c.chapterId}/narration/generate`, {
        replace: true,
        ai: aiText().ai ?? null,
      });
      toast.success(stage === "plan" ? `正在重新规划 ${c.title}` : `正在重写 ${c.title} 的旁白`);
      await done();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
      setRedo(null);
    }
  };
  if (!chapters.length) return null;
  const work = (c: StaleChapter) =>
    stage === "plan" ? `${c.pages} 页，${c.panels} 格中已绘制 ${c.drawnPanels} 格` : `${c.narrationLines} 句旁白`;
  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
      <p className="font-medium text-amber-800 dark:text-amber-200">
        {stage === "plan" ? "规划后原文发生变化的章节" : "编写旁白后内容发生变化的章节"}
      </p>
      <ul className="space-y-2">
        {chapters.map((c) => (
          <li key={c.chapterId} className="flex flex-wrap items-center gap-2">
            <span className="mr-auto min-w-0">
              <span className="font-medium">{c.title}</span> <span className="muted">· {work(c)}</span>
            </span>
            <button
              type="button"
              className="btn-secondary px-2 py-1 text-xs"
              disabled={busy !== null}
              onClick={() => keep(c)}
            >
              保留当前内容
            </button>
            <button
              type="button"
              className="btn-secondary px-2 py-1 text-xs"
              disabled={busy !== null}
              onClick={() => setRedo(c)}
            >
              {stage === "plan" ? "重新规划" : "重写旁白"}
            </button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={redo !== null}
        title={stage === "plan" ? "重新规划本章" : "重写本章旁白"}
        confirmLabel={stage === "plan" ? "重新规划" : "重写旁白"}
        danger
        busy={busy !== null}
        onClose={() => setRedo(null)}
        onConfirm={() => redo && redoIt(redo)}
      >
        {redo &&
          (stage === "plan" ? (
            <p>
              重新规划 <strong>{redo.title}</strong> 会根据当前原文替换 <strong>{redo.pages} 页</strong>、
              <strong>{redo.panels} 格</strong>的规划，包括已绘制的 {redo.drawnPanels}{" "}
              格画稿及对应旁白。此操作会调用文本模型并产生费用。
            </p>
          ) : (
            <p>
              重写 <strong>{redo.title}</strong> 的旁白会替换 <strong>{redo.narrationLines} 句旁白</strong>
              及其音频。此操作会调用文本模型并产生费用。
            </p>
          ))}
      </ConfirmDialog>
    </div>
  );
}

/**
 * The YouTube text and thumbnail headline when what they were written from changed: regenerate them (the YouTube
 * package route, or the headline set to the current title) or keep them. Nothing here happens on its own.
 */
export function PublishingFlags({ projectId, flags }: { projectId: string; flags: Staleness["publishing"] }) {
  const qc = useQueryClient();
  const project = useProject();
  const aiText = useAiBody("text");
  const [busy, setBusy] = useState(false);
  const stale = flags.filter((f) => f.stale);
  if (!stale.length) return null;
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      await qc.invalidateQueries({ queryKey: ["project", projectId] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const thumb = project.data?.project.settings.thumbnail;
  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
      {stale.map((f) => (
        <div key={f.key} className="flex flex-wrap items-center gap-2">
          <span className="mr-auto min-w-0">
            <span className="font-medium text-amber-800 dark:text-amber-200">
              {f.key === "youtube_text" ? "YouTube 文案可能已过期" : "缩略图标题可能已过期"}
            </span>
            <span className="muted"> · {f.reasons.join("; ")}</span>
          </span>
          <button
            type="button"
            className="btn-secondary px-2 py-1 text-xs"
            disabled={busy || (f.key === "thumbnail" && !thumb)}
            onClick={() =>
              f.key === "youtube_text"
                ? act(
                    () => post(`/projects/${projectId}/youtube-package`, { ai: aiText().ai ?? null }),
                    "正在重新生成 YouTube 文案",
                  )
                : act(
                    () =>
                      patch(`/projects/${projectId}`, {
                        settings: { thumbnail: { ...thumb, title: project.data?.project.title ?? "" } },
                      }),
                    "缩略图标题已设为当前项目标题",
                  )
            }
          >
            {f.key === "youtube_text" ? "重新生成" : "使用当前标题"}
          </button>
          <button
            type="button"
            className="btn-secondary px-2 py-1 text-xs"
            disabled={busy}
            onClick={() => act(() => post(`/projects/${projectId}/keep-current`, { item: f.key }), "已保留当前内容")}
          >
            保留当前内容
          </button>
        </div>
      ))}
    </div>
  );
}
