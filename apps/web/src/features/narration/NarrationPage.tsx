import { NARRATION_LANGUAGES, voiceMatchesLanguage } from "@openmanga/domain/browser";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Download, ListChecks, Mic, Plus, Trash2, Volume2, Wand2 } from "lucide-react";
import { useState } from "react";
import { api, del, get, patch, post } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import type { ChapterListItem, NarrationDoc, PanelRow, TtsStatus } from "../../api/types.ts";
import { ConfirmDialog, EmptyState, ErrorBox, Field, fmt, PageHeader, Spinner, toast } from "../../components/ui.tsx";
import { AiChip, useAiBody } from "../ai/AiPicker.tsx";
import { JsonBlock } from "../generation/shared.tsx";
import { useProject, useProjectId } from "../project/ProjectLayout.tsx";
import { ChapterPlayer } from "./ChapterPlayer.tsx";
import { ImportRecording } from "./ImportRecording.tsx";
import { LineEditor } from "./LineEditor.tsx";
import { SynthesisProgress } from "./SynthesisProgress.tsx";

function TtsBanner({ status }: { status: TtsStatus | undefined }) {
  if (!status) return null;
  const s = status.status.state;
  const ok = status.enabled && status.status.ok;
  const msg = !status.enabled
    ? "服务器已禁用旁白合成（TTS_ENABLED=false），仍可撰写旁白。"
    : ok
      ? `本地 Kokoro 语音合成已就绪（${status.provider}），无需支付外部 API 费用。`
      : s === "loading"
        ? "Kokoro 正在加载模型，合成请求将等待并重试。"
        : "Kokoro 未连接，排队中的合成任务将重试，请检查 kokoro 容器。";
  return (
    <div
      className={`mb-4 flex items-start gap-2 rounded-lg border p-3 text-sm ${ok ? "border-emerald-500/40 bg-emerald-500/10" : "border-amber-500/40 bg-amber-500/10"}`}
    >
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 text-emerald-500" />
      ) : (
        <AlertTriangle className="mt-0.5 size-4 text-amber-500" />
      )}
      <div>
        {msg}
        {status.status.detail && !ok && <div className="muted text-xs">{status.status.detail}</div>}
      </div>
    </div>
  );
}

export function NarrationPage() {
  const projectId = useProjectId();
  const { data: overview } = useProject();
  const search = useSearch({ strict: false }) as { chapterId?: string };
  const navigate = useNavigate();
  const chapters = useQuery({
    queryKey: qk.chapters(projectId),
    queryFn: () => get<{ chapters: ChapterListItem[] }>(`/projects/${projectId}/chapters`),
  });
  const chapterId = search.chapterId ?? chapters.data?.chapters[0]?.id;
  const [language, setLanguage] = useState<string>();
  const lang = language ?? overview?.project.language ?? "en";
  const tts = useQuery({
    queryKey: ["tts-status"],
    queryFn: () => get<TtsStatus>("/tts/status"),
    refetchInterval: (q) => (q.state.data?.status.ok ? 60_000 : 10_000),
  });
  const doc = useQuery({
    queryKey: [...qk.narration(chapterId ?? ""), lang],
    queryFn: () => get<NarrationDoc>(`/chapters/${chapterId}/narration?language=${encodeURIComponent(lang)}`),
    enabled: Boolean(chapterId),
  });
  const panels = useQuery({
    queryKey: ["chapter", chapterId, "panels"],
    queryFn: () => get<{ panels: (PanelRow & { pageOrder: number })[] }>(`/chapters/${chapterId}/panels`),
    enabled: Boolean(chapterId),
  });
  const [showTimeline, setShowTimeline] = useState(false);
  const timeline = useQuery({
    queryKey: ["chapter", chapterId, "timeline", lang],
    queryFn: () => get<unknown>(`/chapters/${chapterId}/narration/timeline?language=${encodeURIComponent(lang)}`),
    enabled: Boolean(chapterId) && showTimeline,
  });

  const settings = overview?.project.settings;
  const [voice, setVoice] = useState<string>();
  const [speed, setSpeed] = useState<number>();
  const curVoice = voice ?? settings?.narrationVoice ?? "af_heart";
  const curSpeed = speed ?? settings?.narrationSpeed ?? 1;
  const invalidate = [qk.narration(chapterId ?? "")] as const;

  const saveDefaults = useAction(
    (s: { narrationVoice?: string; narrationSpeed?: number; narrationStyle?: string }) =>
      patch(`/projects/${projectId}`, { settings: s }),
    { invalidate: [qk.project(projectId), ...invalidate], success: "旁白默认设置已保存" },
  );
  const [style, setStyle] = useState<string>();
  const curStyle = style ?? settings?.narrationStyle ?? "";
  const aiText = useAiBody("text");
  const aiTts = useAiBody("tts");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const generate = useAction(
    (replace: boolean) =>
      post(`/chapters/${chapterId}/narration/generate`, { ...aiText(), style: curStyle, replace, language: lang }),
    { success: "旁白撰写已排队", onSuccess: () => setConfirmReplace(false) },
  );
  const synthAll = useAction(
    () =>
      post<{ queued: number; total: number }>(`/chapters/${chapterId}/narration/synthesize`, {
        ...aiTts(),
        onlyMissing: true,
        language: lang,
      }),
    {
      invalidate,
      success: (r) => (r.queued ? `${r.total} 个片段中有 ${r.queued} 个已排队合成` : "所有片段均已有最新音频"),
    },
  );
  const applyPauses = useAction(
    () => post<{ updated: number }>(`/chapters/${chapterId}/narration/pauses`, { language: lang }),
    { invalidate, success: (r) => `已更新 ${r.updated} 个片段的停顿` },
  );
  const cancelSynth = useAction(
    () => post<{ cancelled: number }>(`/chapters/${chapterId}/narration/synthesize/cancel`),
    { invalidate, success: (r) => `已取消 ${r.cancelled} 个排队中的合成任务` },
  );
  // Deletes audio files from disk; the narration text stays and can be synthesized again.
  const [deleteAudio, setDeleteAudio] = useState<"chapter" | "project" | null>(null);
  const [audioScope, setAudioScope] = useState<"chapter" | "project">("chapter");
  const removeAudio = useAction(
    (scope: "chapter" | "project") =>
      del<{ files: number; bytes: number }>(
        scope === "chapter"
          ? `/chapters/${chapterId}/narration/audio?language=${encodeURIComponent(lang)}`
          : `/projects/${projectId}/narration/audio`,
      ),
    {
      invalidate: [...invalidate, qk.project(projectId), ["narration-progress", projectId]],
      success: (r) => `已删除 ${r.files} 个音频文件，释放 ${fmt.bytes(r.bytes)}`,
      onSuccess: () => setDeleteAudio(null),
    },
  );
  const addLine = useAction(
    () => post(`/chapters/${chapterId}/narration/lines`, { text: "New narration line.", language: lang }),
    {
      invalidate,
    },
  );
  const exportKind = useAction(
    (kind: "narration_audio" | "timeline") =>
      post(`/projects/${projectId}/exports`, {
        kind,
        chapterId,
        language: lang,
        audio: { format: "mp3", normalize: true },
      }),
    { success: "导出已排队，可在导出页查看" },
  );
  const [previewing, setPreviewing] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);

  const preview = async () => {
    setPreviewing(true);
    try {
      const res = await api<Response>("/tts/preview", {
        method: "POST",
        body: { voice: curVoice, speed: curSpeed, ...aiTts() },
        raw: true,
      });
      const url = URL.createObjectURL(await res.blob());
      const a = new Audio(url);
      a.onended = () => URL.revokeObjectURL(url);
      await a.play();
    } catch (e) {
      toast.error(e);
    } finally {
      setPreviewing(false);
    }
  };

  const allSegments = doc.data?.lines.flatMap((l) => l.segments) ?? [];
  const panelOptions = (panels.data?.panels ?? []).map((p) => ({
    id: p.id,
    label: `p${p.pageOrder}·${p.order} ${p.storyBeat.slice(0, 40)}`,
  }));
  const voices = [...(tts.data?.voices ?? [])].sort(
    (a, b) => Number(voiceMatchesLanguage(b.language, lang)) - Number(voiceMatchesLanguage(a.language, lang)),
  );

  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageHeader
        title="旁白"
        subtitle="先编写结构化旁白，再通过本地 Kokoro 合成语音。"
        actions={
          <select
            className="input w-auto"
            value={chapterId ?? ""}
            onChange={(e) =>
              navigate({
                to: "/projects/$projectId/narration",
                params: { projectId },
                search: { chapterId: e.target.value },
              })
            }
            aria-label="章节"
          >
            {chapters.data?.chapters.map((c) => (
              <option key={c.id} value={c.id}>
                第 {c.order} 章 — {c.title}
              </option>
            ))}
          </select>
        }
      />
      <SynthesisProgress projectId={projectId} language={lang} />
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          旁白语言
          <select className="input w-auto" value={lang} onChange={(e) => setLanguage(e.target.value)}>
            {NARRATION_LANGUAGES.map((l) => {
              const n = doc.data?.tracks?.find((t) => t.language === l.code)?.lines;
              return (
                <option key={l.code} value={l.code}>
                  {new Intl.DisplayNames(["zh-CN"], { type: "language" }).of(l.code) ?? l.name}
                  {n ? `（${n} 行）` : ""}
                </option>
              );
            })}
          </select>
        </label>
        <span className="muted text-xs">每种语言在同一套画稿上使用独立旁白轨道，撰写后请选择对应语言的音色合成。</span>
      </div>

      <TtsBanner status={tts.data} />
      {!chapters.isLoading && !chapters.data?.chapters.length && (
        <EmptyState icon={<Mic className="size-8" />} title="暂无章节">
          请先在故事或章节页创建章节。
        </EmptyState>
      )}
      {chapterId && (
        <>
          <div className="card mb-4 grid gap-3 p-4 md:grid-cols-[1fr_1fr_auto]">
            <Field label="默认音色">
              <select
                className="input"
                value={curVoice}
                onChange={(e) => {
                  setVoice(e.target.value);
                  saveDefaults.mutate({ narrationVoice: e.target.value });
                }}
              >
                {!voices.some((v) => v.id === curVoice) && <option value={curVoice}>{curVoice}</option>}
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v.language}
                    {v.gender ? ` · ${v.gender === "female" ? "女声" : v.gender === "male" ? "男声" : v.gender}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`默认语速 ×${curSpeed.toFixed(2)}`}>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={curSpeed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                onMouseUp={() => saveDefaults.mutate({ narrationSpeed: curSpeed })}
                onKeyUp={() => saveDefaults.mutate({ narrationSpeed: curSpeed })}
                className="w-full"
              />
            </Field>
            <div className="flex items-end">
              <button
                type="button"
                className="btn-secondary"
                onClick={preview}
                disabled={previewing || !tts.data?.enabled}
              >
                {previewing ? <Spinner /> : <Volume2 className="size-4" />} 试听音色
              </button>
            </div>
          </div>

          <div className="card mb-4 flex flex-wrap items-end gap-2 p-4">
            <div className="min-w-60 flex-1">
              <Field label="旁白风格（应用于所有章节）">
                <input
                  className="input"
                  placeholder="例如：悬疑回顾、第二人称叙述"
                  value={curStyle}
                  maxLength={500}
                  onChange={(e) => setStyle(e.target.value)}
                  onBlur={() =>
                    curStyle !== (settings?.narrationStyle ?? "") && saveDefaults.mutate({ narrationStyle: curStyle })
                  }
                />
              </Field>
            </div>
            <AiChip cap="text" />
            <button
              type="button"
              className="btn-secondary"
              onClick={() => generate.mutate(false)}
              disabled={generate.isPending}
            >
              <Wand2 className="size-4" /> 撰写旁白
            </button>
            <button type="button" className="btn-ghost" onClick={() => setConfirmReplace(true)}>
              重新生成（替换）
            </button>
            <button
              type="button"
              className="btn-ghost"
              title={`按项目设置将普通停顿设为 ${settings?.narrationPauseMs ?? 350} 毫秒，场景或章节末尾停顿设为 ${settings?.sceneBreakPauseMs ?? 700} 毫秒，保留音频。`}
              onClick={() => applyPauses.mutate()}
              disabled={applyPauses.isPending || !allSegments.length}
            >
              应用停顿设置
            </button>
            <AiChip cap="tts" />
            <button
              type="button"
              className="btn-primary"
              onClick={() => synthAll.mutate()}
              disabled={synthAll.isPending || !tts.data?.enabled || !allSegments.length}
            >
              <Mic className="size-4" /> 合成所有缺失音频
            </button>
            {allSegments.length > 0 && <ImportRecording projectId={projectId} chapterId={chapterId} language={lang} />}
            {allSegments.some((sg) => sg.job?.status === "queued") && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => cancelSynth.mutate()}
                disabled={cancelSynth.isPending}
              >
                取消排队中的合成
              </button>
            )}
            <button
              type="button"
              className="btn-ghost text-red-500"
              title="删除磁盘上的旁白音频文件，保留文字"
              onClick={() => {
                setAudioScope("chapter");
                setDeleteAudio("chapter");
              }}
            >
              <Trash2 className="size-4" /> 删除音频
            </button>
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <ChapterPlayer segments={allSegments} onCurrent={setCurrent} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => exportKind.mutate("narration_audio")}>
                <Download className="size-4" /> 下载音频
              </button>
              <Link
                to="/projects/$projectId/narration/qa"
                params={{ projectId }}
                search={{ chapterId }}
                className="btn-ghost"
                title="检查重复、复述对白、密度和语速，仅修复标记的旁白行"
              >
                <ListChecks className="size-4" /> 旁白质检
              </Link>
              <Link to="/projects/$projectId/exports" params={{ projectId }} className="btn-ghost">
                导出 →
              </Link>
            </div>
          </div>

          {doc.error && <ErrorBox error={doc.error} onRetry={() => doc.refetch()} />}
          {doc.isLoading ? (
            <Spinner />
          ) : !doc.data?.lines.length ? (
            <EmptyState
              title="暂无旁白"
              action={
                <button type="button" className="btn-primary" onClick={() => addLine.mutate()}>
                  <Plus className="size-4" /> 添加旁白行
                </button>
              }
            >
              使用文本模型生成旁白，或手动撰写。
            </EmptyState>
          ) : (
            <div className="space-y-3">
              {doc.data.lines.map((l) => (
                <LineEditor
                  key={l.id}
                  line={l}
                  panels={panelOptions}
                  voices={voices}
                  invalidate={invalidate}
                  currentSegmentId={current}
                  defaults={doc.data.defaults}
                />
              ))}
              <button
                type="button"
                className="btn-secondary"
                onClick={() => addLine.mutate()}
                disabled={addLine.isPending}
              >
                <Plus className="size-4" /> 添加旁白行
              </button>
            </div>
          )}

          <details className="card mt-4 p-4" onToggle={(e) => setShowTimeline((e.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer font-medium">时间轴清单</summary>
            <p className="muted my-2 text-xs">用于后续回顾视频生成的画格与音频时间轴数据。</p>
            {timeline.isLoading ? <Spinner /> : timeline.data ? <JsonBlock value={timeline.data} /> : null}
            <button type="button" className="btn-secondary mt-2" onClick={() => exportKind.mutate("timeline")}>
              <Download className="size-4" /> 导出时间轴 JSON
            </button>
          </details>
        </>
      )}
      <ConfirmDialog
        open={deleteAudio !== null}
        title="删除旁白音频？"
        confirmLabel="删除音频"
        danger
        busy={removeAudio.isPending}
        onClose={() => setDeleteAudio(null)}
        onConfirm={() => removeAudio.mutate(audioScope)}
      >
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input type="radio" checked={audioScope === "chapter"} onChange={() => setAudioScope("chapter")} />
            本章（{lang}）
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={audioScope === "project"} onChange={() => setAudioScope("project")} />
            整个项目的全部章节与语言，包括已删除旁白行的音频
          </label>
          <p className="muted">音频文件会立即从磁盘删除，保留旁白文字。重新合成即可恢复音频，使用本地音色免费。</p>
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmReplace}
        title="替换旁白？"
        confirmLabel="替换"
        danger
        busy={generate.isPending}
        onClose={() => setConfirmReplace(false)}
        onConfirm={() => generate.mutate(true)}
      >
        未作为页面字幕显示的现有旁白行将被删除并重写，其已合成音频将解除关联。
      </ConfirmDialog>
    </div>
  );
}
