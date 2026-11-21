import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileAudio } from "lucide-react";
import { useState } from "react";
import { api, get, post } from "../../api/client.ts";
import { qk } from "../../api/hooks.ts";
import { ConfirmDialog, fmt, Spinner, toast } from "../../components/ui.tsx";

type Result = {
  segments: number;
  attached: number;
  missedCount: number;
  missed: { segmentId: string; text: string; matched: number; words: number }[];
  recordingMs: number;
};
type JobView = { job: { id: string; status: string; failureReason: string | null; result: unknown } };

/**
 * Narration recorded outside OpenManga, cut into this chapter's (or the whole project's) segments: the recording is
 * transcribed on the server and each segment whose words are found gets its stretch of the recording as audio.
 */
export function ImportRecording({
  projectId,
  chapterId,
  language,
}: {
  projectId: string;
  chapterId: string;
  language: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"chapter" | "project">("chapter");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [job, setJob] = useState<{ id: string; startedAt: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const send = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const base = scope === "chapter" ? `/chapters/${chapterId}` : `/projects/${projectId}`;
      const r = await api<{ job: { id: string } }>(
        `${base}/narration/import?language=${encodeURIComponent(language)}&name=${encodeURIComponent(file.name)}`,
        { method: "POST", body: file },
      );
      setJob({ id: r.job.id, startedAt: Date.now() });
      setResult(null);
      setOpen(false);
      setFile(null);
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
    }
  };

  useQuery({
    queryKey: ["narration-import", job?.id],
    enabled: Boolean(job),
    refetchInterval: 5000,
    queryFn: async () => {
      const { job: j } = await get<JobView>(`/generations/${job!.id}`);
      if (!["completed", "failed", "cancelled"].includes(j.status)) return j.status;
      setJob(null);
      if (j.status === "completed") {
        const r = j.result as Result;
        setResult(r);
        toast.success(`录音已导入，${r.segments} 个片段中有 ${r.attached} 个已匹配音频`);
      } else if (j.status === "failed") toast.error(new Error(j.failureReason ?? "导入失败"));
      await qc.invalidateQueries({ queryKey: qk.narration(chapterId) });
      await qc.invalidateQueries({ queryKey: ["narration-progress", projectId] });
      return j.status;
    },
  });

  const cancel = async () => {
    if (!job) return;
    try {
      await post(`/generations/${job.id}/cancel`);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setOpen(true)}
        disabled={Boolean(job)}
        title="导入外部录制的旁白，并按朗读内容切分到对应片段"
      >
        <FileAudio className="size-4" /> 导入录音
      </button>
      {job && (
        <div className="flex w-full items-center gap-2 rounded-lg border border-[var(--border)] p-2 text-sm">
          <Spinner />
          <span>
            正在导入录音（开始于 {new Date(job.startedAt).toLocaleTimeString("zh-CN")}），转写耗时约为录音时长的一半。
          </span>
          <button type="button" className="btn-ghost ml-auto py-1" onClick={cancel}>
            取消
          </button>
        </div>
      )}
      {result && (
        <details className="w-full rounded-lg border border-[var(--border)] p-2 text-sm" open={result.missedCount > 0}>
          <summary className="cursor-pointer">
            已导入 {fmt.ms(result.recordingMs)} 的音频，已匹配 {result.attached} / {result.segments} 个片段
            {result.missedCount ? `，其中 ${result.missedCount} 个未在录音中找到` : ""}
            <button type="button" className="btn-ghost ml-2 py-0 text-xs" onClick={() => setResult(null)}>
              关闭
            </button>
          </summary>
          {result.missedCount > 0 && (
            <>
              <p className="muted my-1 text-xs">
                这些片段保留了原有音频。请将文字改为与录音一致后重新导入，或为片段单独上传录音。
              </p>
              <ul className="space-y-1">
                {result.missed.map((m) => (
                  <li key={m.segmentId} className="text-xs">
                    <span className="muted">
                      {m.matched}/{m.words} 个词已识别 ·{" "}
                    </span>
                    {m.text}
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}
      <ConfirmDialog
        open={open}
        title="导入旁白录音"
        confirmLabel="上传并导入"
        busy={uploading}
        disabled={!file}
        onClose={() => setOpen(false)}
        onConfirm={send}
      >
        <div className="space-y-3 text-sm">
          <p>
            请提供按此处文字和顺序朗读的旁白录音，支持任意音频格式。服务器会转写录音，并在片段间的停顿处切分，将匹配到的音频分配给对应片段。“合成所有缺失音频”会保留已导入的音频。
          </p>
          <label className="flex items-center gap-2">
            <input type="radio" checked={scope === "chapter"} onChange={() => setScope("chapter")} />
            本章旁白
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={scope === "project"} onChange={() => setScope("project")} />
            整个项目，按章节顺序导入
          </label>
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.opus"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && (
            <p className="muted text-xs">
              {file.name} · {fmt.bytes(file.size)}
            </p>
          )}
        </div>
      </ConfirmDialog>
    </>
  );
}
