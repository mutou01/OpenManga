import type { NarrationFindingRow } from "@openmanga/db/types";
import { NARRATION_LANGUAGES } from "@openmanga/domain/browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import clsx from "clsx";
import { AudioLines, ListChecks, Mic, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";
import { get, patch, post } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import type { ChapterListItem } from "../../api/types.ts";
import { EmptyState, ErrorBox, Modal, PageHeader, Spinner, Tabs, toast } from "../../components/ui.tsx";
import { AiChip, useAiBody } from "../ai/AiPicker.tsx";
import { useProject, useProjectId } from "../project/ProjectLayout.tsx";

type Finding = NarrationFindingRow & { fixable: boolean; check: "rule" | "ai" | "audio" };
type Loudness = {
  chapterId: string;
  lufs: number | null;
  lra: number | null;
  truePeakDb: number | null;
  measuredAt: string | null;
};
type Findings = {
  findings: Finding[];
  audio: Loudness[];
  lines: { id: string; chapterId: string; order: number; text: string }[];
  counts: { byStatus: Record<string, number>; openByKind: Record<string, number> };
};
type Density = {
  target: { wordsPerShot: number; wordsPerMinute: number };
  chapters: {
    id: string;
    order: number;
    title: string;
    words: number;
    shotCount: number;
    silentShots: number;
    wordsPerShot: number;
    wordsPerMinute: number | null;
    audioMs: number | null;
    /** Shot by shot, for the chapter asked about. */
    shots?: { id: string; words: number; silent: boolean }[];
  }[];
};
type Comparison = { found: number; introduced: number; remaining: number; resolved: number };
type JobView = { job: { id: string; kind: string; status: string; failureReason: string | null; result: unknown } };
type Proposal = { lineId: string; key: string; before: string; after: string };

const KIND_LABEL: Record<string, string> = {
  repeated_opening: "重复开头",
  flat_rhythm: "节奏平淡",
  name_overuse: "姓名使用过多",
  near_duplicate: "旁白近似重复",
  restates_dialogue: "复述对白",
  chapter_opening: "章节开头雷同",
  chapter_ending: "章节结尾雷同",
  dense_shot: "镜头旁白过密",
  silent_stretch: "长段无旁白",
  pace: "语速",
  repeated_meaning: "语义重复",
  cross_chapter_repeat: "重复前文",
  fact_overexplained: "重复解释事实",
  describes_frame: "仅描述画面",
  audio_silent: "音频静音",
  audio_clipping: "音频削波",
  audio_gap: "行内停顿过长",
  audio_level: "音量不均",
  audio_loudness: "章节响度",
};
const SEVERITY_STYLE: Record<string, string> = {
  high: "bg-red-500/15 text-red-700 dark:text-red-300",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  low: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
};
const summary = (c: Comparison) =>
  `发现 ${c.found} 项 · 新增 ${c.introduced} 项 · 自上次检查以来已解决 ${c.resolved} 项`;
const sumComparisons = (rows: Comparison[]) =>
  rows.reduce(
    (a, r) => ({
      found: a.found + r.found,
      introduced: a.introduced + r.introduced,
      remaining: a.remaining + r.remaining,
      resolved: a.resolved + r.resolved,
    }),
    { found: 0, introduced: 0, remaining: 0, resolved: 0 },
  );

/**
 * Narration QA for a chapter or the whole project: the findings of the deterministic and AI checks, by type, to
 * review, ignore or fix; fixes rewrite only the flagged lines and are shown as a diff before they are applied.
 */
export function NarrationQaPage() {
  const projectId = useProjectId();
  const { data: overview } = useProject();
  const search = useSearch({ strict: false }) as { chapterId?: string };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const chapterId = search.chapterId;
  const [language, setLanguage] = useState<string>();
  const lang = language ?? overview?.project.language ?? "en";
  const [tab, setTab] = useState<"findings" | "density" | "loudness">("findings");
  const [status, setStatus] = useState<"open" | "ignored" | "fixed">("open");
  const [kind, setKind] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Jobs this page started and is waiting on: AI checks, and fixes whose proposal opens for review. */
  const [jobs, setJobs] = useState<{ id: string; kind: "lint" | "fix" | "audio"; chapterId: string }[]>([]);
  const [review, setReview] = useState<{ jobId: string; chapterId: string; proposals: Proposal[] } | null>(null);
  const aiText = useAiBody("text");
  const aiTts = useAiBody("tts");

  const chapters = useQuery({
    queryKey: qk.chapters(projectId),
    queryFn: () => get<{ chapters: ChapterListItem[] }>(`/projects/${projectId}/chapters`),
  });
  const scope = `language=${encodeURIComponent(lang)}${chapterId ? `&chapterId=${chapterId}` : ""}`;
  const findingsKey = ["narration-qa", projectId, lang, chapterId ?? "all"] as const;
  const findings = useQuery({
    queryKey: findingsKey,
    queryFn: () => get<Findings>(`/projects/${projectId}/narration/findings?${scope}`),
  });
  const density = useQuery({
    queryKey: ["narration-density", projectId, lang, chapterId ?? "all"],
    queryFn: () => get<Density>(`/projects/${projectId}/narration/density?${scope}`),
    enabled: tab === "density",
  });
  // Polls the jobs this page started; a finished check refreshes the findings, a finished fix opens its review.
  useQuery({
    queryKey: ["narration-qa-jobs", jobs.map((j) => j.id).join(",")],
    enabled: jobs.length > 0,
    refetchInterval: 2500,
    queryFn: async () => {
      for (const j of jobs) {
        const { job } = await get<JobView>(`/generations/${j.id}`);
        if (job.status === "completed" && j.kind === "fix") {
          const proposals = (job.result as { proposals?: Proposal[] } | null)?.proposals ?? [];
          if (proposals.length) setReview({ jobId: j.id, chapterId: j.chapterId, proposals });
          else toast.success("模型未发现这些旁白行需要修改");
        }
        if (job.status === "completed" && j.kind === "lint")
          toast.success(`AI 检查：${summary(job.result as Comparison)}`);
        if (job.status === "completed" && j.kind === "audio")
          toast.success(`音频检查：${summary(job.result as Comparison)}`);
        if (job.status === "failed") toast.error(new Error(job.failureReason ?? "任务失败"));
        if (["completed", "failed", "cancelled"].includes(job.status)) {
          setJobs((all) => all.filter((x) => x.id !== j.id));
          await qc.invalidateQueries({ queryKey: findingsKey });
        }
      }
      return jobs.length;
    },
  });

  const lintUrl = chapterId ? `/chapters/${chapterId}/narration/lint` : `/projects/${projectId}/narration/lint`;
  const runRules = useAction(() => post<{ rules: Comparison | Comparison[] }>(lintUrl, { language: lang }), {
    invalidate: [findingsKey],
    success: (r) => `检查结果：${summary(Array.isArray(r.rules) ? sumComparisons(r.rules) : r.rules)}`,
  });
  const runAi = useAction(
    () =>
      post<{ job?: { id: string; targetId: string } | null; jobs?: { id: string; targetId: string }[] }>(lintUrl, {
        language: lang,
        semantic: true,
        ...aiText(),
      }),
    {
      invalidate: [findingsKey],
      success: (r) => {
        const started = r.jobs ?? (r.job ? [r.job] : []);
        setJobs((all) => [...all, ...started.map((j) => ({ id: j.id, kind: "lint" as const, chapterId: j.targetId }))]);
        return `${started.length} 章的 AI 检查已排队，粘贴模式任务请前往生成页处理`;
      },
    },
  );
  const runAudio = useAction(
    () => post<{ audioJob: { id: string; targetId: string } }>(lintUrl, { language: lang, audio: true }),
    {
      invalidate: [findingsKey],
      success: (r) => {
        setJobs((all) => [...all, { id: r.audioJob.id, kind: "audio", chapterId: r.audioJob.targetId }]);
        return "音频检查已排队";
      },
    },
  );
  // A new take of the lines an audio finding points at; the finding stays open until the audio is checked again.
  const revoice = useAction(
    (f: Finding) =>
      post<{ queued: number }>(`/chapters/${f.chapterId}/narration/synthesize`, {
        lineIds: f.lineIds,
        onlyMissing: false,
        newTake: true,
        language: lang,
        ...aiTts(),
      }),
    { success: (r) => `${r.queued} 个片段已排队重新配音，完成后请再次检查音频` },
  );
  const setFindingStatus = useAction(
    (v: { id: string; status: "open" | "ignored" }) => patch(`/narration-findings/${v.id}`, { status: v.status }),
    { invalidate: [findingsKey] },
  );
  const fix = useAction(
    async () => {
      const chosen = (findings.data?.findings ?? []).filter((f) => selected.has(f.id));
      const byChapter = new Map<string, Finding[]>();
      for (const f of chosen) byChapter.set(f.chapterId, [...(byChapter.get(f.chapterId) ?? []), f]);
      const started: { id: string; chapterId: string }[] = [];
      for (const [ch, list] of byChapter) {
        const r = await post<{ job: { id: string } }>(`/chapters/${ch}/narration/fix`, {
          findingIds: list.map((f) => f.id),
          language: lang,
          ...aiText(),
        });
        started.push({ id: r.job.id, chapterId: ch });
      }
      return started;
    },
    {
      success: (started) => {
        setJobs((all) => [...all, ...started.map((s) => ({ ...s, kind: "fix" as const }))]);
        setSelected(new Set());
        return `${started.length} 章的修复已排队，完成后将在此处打开方案供审阅`;
      },
    },
  );

  const all = findings.data?.findings ?? [];
  const shown = all.filter((f) => f.status === status && (!kind || f.kind === kind));
  const lineText = new Map((findings.data?.lines ?? []).map((l) => [l.id, l]));
  const chapterName = new Map((chapters.data?.chapters ?? []).map((c) => [c.id, `第 ${c.order} 章 — ${c.title}`]));
  const busy = jobs.length > 0;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <PageHeader
        title="旁白质检"
        subtitle="逐行审阅、忽略或修复重复旁白、复述对白、镜头旁白过密或缺失以及语速问题。"
        actions={
          <>
            <select
              className="input w-auto max-w-full"
              aria-label="章节"
              value={chapterId ?? ""}
              onChange={(e) =>
                navigate({
                  to: "/projects/$projectId/narration/qa",
                  params: { projectId },
                  search: e.target.value ? { chapterId: e.target.value } : {},
                })
              }
            >
              <option value="">全部章节</option>
              {chapters.data?.chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  第 {c.order} 章 — {c.title}
                </option>
              ))}
            </select>
            <select
              className="input w-auto"
              aria-label="旁白语言"
              value={lang}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {NARRATION_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {new Intl.DisplayNames(["zh-CN"], { type: "language" }).of(l.code) ?? l.name}
                </option>
              ))}
            </select>
            <Link
              to="/projects/$projectId/narration"
              params={{ projectId }}
              search={chapterId ? { chapterId } : {}}
              className="btn-ghost"
            >
              旁白 →
            </Link>
          </>
        }
      />

      <div className="card mb-4 flex flex-wrap items-center gap-2 p-4">
        <button
          type="button"
          className="btn-primary"
          onClick={() => runRules.mutate()}
          disabled={runRules.isPending}
          title="通过计数和对比进行规则检查，无需调用模型或付费"
        >
          {runRules.isPending ? <Spinner /> : <ListChecks className="size-4" />} 运行检查
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => runAi.mutate()}
          disabled={runAi.isPending}
          title="检查换词重复、重复解释事实以及仅描述画面的旁白，每章创建一个文本任务"
        >
          <Sparkles className="size-4" /> AI 检查
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => runAudio.mutate()}
          disabled={runAudio.isPending}
          title="测量已配音音频的静音、削波、停顿、音量不均与章节响度，无需调用模型或付费"
        >
          <AudioLines className="size-4" /> 检查音频
        </button>
        <AiChip cap="text" />
        {busy && (
          <Link
            to="/projects/$projectId/generation"
            params={{ projectId }}
            className="muted flex items-center gap-1 text-xs underline"
            title="粘贴模式任务在生成页等待你提交结果"
          >
            <Spinner className="size-3" /> {jobs.length} 个任务进行中 · 生成页
          </Link>
        )}
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "findings", label: `问题（${findings.data?.counts.byStatus.open ?? 0} 项待处理）` },
          { value: "density", label: "密度" },
          { value: "loudness", label: "响度" },
        ]}
      />

      {tab === "density" ? (
        <DensityView data={density.data} loading={density.isLoading} chapterId={chapterId} />
      ) : tab === "loudness" ? (
        <LoudnessView
          rows={findings.data?.audio ?? []}
          chapters={chapters.data?.chapters ?? []}
          chapterId={chapterId}
        />
      ) : (
        <>
          {findings.error && <ErrorBox error={findings.error} onRetry={() => findings.refetch()} />}
          <div className="mb-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              className={clsx("chip", !kind && "ring-2 ring-accent-500")}
              onClick={() => setKind(null)}
            >
              全部待处理 · {findings.data?.counts.byStatus.open ?? 0}
            </button>
            {Object.entries(findings.data?.counts.openByKind ?? {}).map(([k, n]) => (
              <button
                key={k}
                type="button"
                className={clsx("chip", kind === k && "ring-2 ring-accent-500")}
                onClick={() => setKind(kind === k ? null : k)}
              >
                {KIND_LABEL[k] ?? k} · {n}
              </button>
            ))}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select
              className="input w-auto"
              aria-label="状态"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as typeof status);
                setSelected(new Set());
              }}
            >
              <option value="open">待处理（{findings.data?.counts.byStatus.open ?? 0}）</option>
              <option value="ignored">已忽略（{findings.data?.counts.byStatus.ignored ?? 0}）</option>
              <option value="fixed">已修复（{findings.data?.counts.byStatus.fixed ?? 0}）</option>
            </select>
            {status === "open" && (
              <button
                type="button"
                className="btn-secondary ml-auto"
                disabled={!selected.size || fix.isPending}
                onClick={() => fix.mutate()}
                title="仅改写所选问题涉及的旁白行，审阅后再保存"
              >
                <Wand2 className="size-4" /> 修复所选 ({selected.size})
              </button>
            )}
          </div>
          {findings.isLoading ? (
            <Spinner />
          ) : !shown.length ? (
            <EmptyState
              icon={<ListChecks className="size-8" />}
              title={`暂无${{ open: "待处理", ignored: "已忽略", fixed: "已修复" }[status]}问题`}
            >
              {all.length ? "当前筛选条件下没有问题。" : "运行检查以审阅这些旁白。"}
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {shown.map((f) => (
                <li key={f.id} className="card flex gap-3 p-3">
                  {status === "open" && (
                    <input
                      type="checkbox"
                      className="mt-1 shrink-0"
                      aria-label="选择修复"
                      disabled={!f.fixable}
                      title={f.fixable ? "选择修复" : f.check === "audio" ? "需要重新配音" : "需要添加旁白行或更换音色"}
                      checked={selected.has(f.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(f.id);
                        else next.delete(f.id);
                        setSelected(next);
                      }}
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm">
                      <span className="font-medium">{KIND_LABEL[f.kind] ?? f.kind}</span>
                      <span className={clsx("chip", SEVERITY_STYLE[f.severity])}>
                        {{ high: "高", medium: "中", low: "低" }[f.severity]}
                      </span>
                      <span className="chip">{{ ai: "AI", rule: "规则", audio: "音频" }[f.check]}</span>
                      {!chapterId && (
                        <Link
                          to="/projects/$projectId/narration/qa"
                          params={{ projectId }}
                          search={{ chapterId: f.chapterId }}
                          className="muted text-xs underline"
                        >
                          {chapterName.get(f.chapterId) ?? "章节"}
                        </Link>
                      )}
                    </div>
                    <p className="text-sm">{f.message}</p>
                    {f.lineIds.map((id) => (
                      <blockquote key={id} className="muted border-l-2 border-[var(--border)] pl-2 text-xs">
                        {lineText.get(id)?.text ?? "（旁白行已删除）"}
                      </blockquote>
                    ))}
                    {f.relatedChapterIds.length > 0 && (
                      <p className="muted text-xs">
                        相关章节：{f.relatedChapterIds.map((id) => chapterName.get(id) ?? "某章节").join("、")}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {f.check === "audio" && f.status === "open" && f.lineIds.length > 0 && (
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        disabled={revoice.isPending}
                        title="重新合成这些旁白行，包括已有缓存配音的片段"
                        onClick={() => revoice.mutate(f)}
                      >
                        <Mic className="size-3.5" /> 重新配音
                      </button>
                    )}
                    {f.status === "ignored" || f.status === "fixed" ? (
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        onClick={() => setFindingStatus.mutate({ id: f.id, status: "open" })}
                      >
                        重新打开
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        onClick={() => setFindingStatus.mutate({ id: f.id, status: "ignored" })}
                      >
                        忽略
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {review && (
        <FixReview
          review={review}
          chapter={chapterName.get(review.chapterId) ?? "章节"}
          ttsBody={aiTts}
          onClose={() => setReview(null)}
          onApplied={(r) => {
            setReview(null);
            if (r.recheckJob)
              setJobs((all) => [...all, { id: r.recheckJob!.id, kind: "lint", chapterId: review.chapterId }]);
            void qc.invalidateQueries({ queryKey: findingsKey });
            void qc.invalidateQueries({ queryKey: qk.narration(review.chapterId) });
          }}
        />
      )}
    </div>
  );
}

type Applied = {
  applied: string[];
  skipped: string[];
  revoiced: number;
  rules: Comparison;
  recheckJob: { id: string } | null;
};

/** The proposal as a diff, line by line, each line accepted or not; nothing is saved until Apply. */
function FixReview({
  review,
  chapter,
  ttsBody,
  onClose,
  onApplied,
}: {
  review: { jobId: string; chapterId: string; proposals: Proposal[] };
  chapter: string;
  ttsBody: () => Record<string, unknown>;
  onClose: () => void;
  onApplied: (r: Applied) => void;
}) {
  const [accepted, setAccepted] = useState(new Set(review.proposals.map((p) => p.lineId)));
  const [revoice, setRevoice] = useState(true);
  const [recheck, setRecheck] = useState(false);
  const apply = useAction(
    () =>
      post<Applied>(`/chapters/${review.chapterId}/narration/fix/apply`, {
        jobId: review.jobId,
        lineIds: [...accepted],
        revoice,
        recheck,
        ...(revoice ? ttsBody() : {}),
      }),
    {
      success: (r) =>
        `已应用 ${r.applied.length} 行${r.skipped.length ? `，跳过期间已被编辑的 ${r.skipped.length} 行` : ""}` +
        `${r.revoiced ? ` · 正在重新配音 ${r.revoiced} 个片段` : ""} · 检查结果：${summary(r.rules)}`,
      onSuccess: onApplied,
    },
  );
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`修复方案 · ${chapter}`}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            放弃
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!accepted.size || apply.isPending}
            onClick={() => apply.mutate()}
          >
            {apply.isPending && <Spinner />} 应用 {accepted.size} 行
          </button>
        </>
      }
    >
      <p className="muted mb-3 text-sm">仅改写标记的旁白行。应用后将重新检查本章，以便确认修复是否引入了新问题。</p>
      <ul className="space-y-3">
        {review.proposals.map((p) => (
          <li key={p.lineId} className="rounded-lg border border-[var(--border)] p-3">
            <label className="mb-2 flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={accepted.has(p.lineId)}
                onChange={(e) => {
                  const next = new Set(accepted);
                  if (e.target.checked) next.add(p.lineId);
                  else next.delete(p.lineId);
                  setAccepted(next);
                }}
              />
              第 {p.key.slice(1)} 行
            </label>
            <p className="rounded bg-red-500/10 p-2 text-sm text-red-800 line-through decoration-red-500/60 dark:text-red-200">
              {p.before}
            </p>
            <p className="mt-1 rounded bg-emerald-500/10 p-2 text-sm text-emerald-800 dark:text-emerald-200">
              {p.after}
            </p>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={revoice} onChange={(e) => setRevoice(e.target.checked)} />
          重新合成修改过的句子
        </label>
        {revoice && <AiChip cap="tts" />}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={recheck} onChange={(e) => setRecheck(e.target.checked)} />
          再次使用 AI 检查（使用修复时的同一模型）
        </label>
      </div>
    </Modal>
  );
}

function DensityView({
  data,
  loading,
  chapterId,
}: {
  data: Density | undefined;
  loading: boolean;
  chapterId?: string;
}) {
  if (loading || !data) return <Spinner />;
  const one = chapterId ? data.chapters.find((c) => c.id === chapterId) : undefined;
  const max = Math.max(data.target.wordsPerShot * 2, ...(one?.shots ?? []).map((s) => s.words));
  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="muted text-left text-xs">
            <tr>
              <th className="p-2">章节</th>
              <th className="p-2 text-right">词数</th>
              <th className="p-2 text-right">镜头数</th>
              <th className="p-2 text-right">每镜头词数</th>
              <th className="p-2 text-right">无旁白镜头</th>
              <th className="p-2 text-right">每分钟词数</th>
            </tr>
          </thead>
          <tbody>
            {(one ? [one] : data.chapters).map((c) => {
              const off =
                c.wordsPerMinute &&
                Math.abs(c.wordsPerMinute - data.target.wordsPerMinute) > data.target.wordsPerMinute * 0.25;
              return (
                <tr key={c.id} className="border-t border-[var(--border)]">
                  <td className="p-2">
                    第 {c.order} 章 — {c.title}
                  </td>
                  <td className="p-2 text-right tabular-nums">{c.words}</td>
                  <td className="p-2 text-right tabular-nums">{c.shotCount}</td>
                  <td className="p-2 text-right tabular-nums">{c.wordsPerShot.toFixed(1)}</td>
                  <td className={clsx("p-2 text-right tabular-nums", c.silentShots && "text-amber-600")}>
                    {c.silentShots}
                  </td>
                  <td className={clsx("p-2 text-right tabular-nums", off && "text-amber-600")}>
                    {c.wordsPerMinute ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted text-xs">
        目标为每镜头约 {data.target.wordsPerShot} 个词、每分钟约 {data.target.wordsPerMinute} 个词。
        每分钟词数仅依据当前音频计算，章节配音前显示“—”。
      </p>
      {one?.shots && (
        <div className="card p-3">
          <h2 className="mb-2 text-sm font-medium">逐镜头统计</h2>
          <div className="overflow-x-auto">
            <div className="flex h-28 items-end gap-px" style={{ minWidth: `${one.shots.length * 6}px` }}>
              {one.shots.map((s, i) => (
                <div
                  key={s.id}
                  title={`镜头 ${i + 1}：${s.words} 个词${s.silent ? "（无旁白）" : ""}`}
                  className={clsx(
                    "min-w-[4px] flex-1 rounded-t-sm",
                    s.silent
                      ? "bg-amber-500/60"
                      : s.words > data.target.wordsPerShot * 2
                        ? "bg-red-500/70"
                        : "bg-accent-500/70",
                  )}
                  style={{ height: `${Math.max(4, (Math.min(s.words, max) / max) * 100)}%` }}
                />
              ))}
            </div>
          </div>
          <p className="muted mt-2 text-xs">柱形表示每镜头词数，琥珀色表示无旁白，红色表示超过目标词数的两倍。</p>
        </div>
      )}
      {chapterId && !one?.shots?.length && <p className="muted text-sm">本章尚未规划镜头。</p>}
    </div>
  );
}

/** Each chapter's loudness from the newest audio check: what the film's normalisation to -14 LUFS starts from. */
function LoudnessView({
  rows,
  chapters,
  chapterId,
}: {
  rows: Loudness[];
  chapters: ChapterListItem[];
  chapterId?: string;
}) {
  const by = new Map(rows.map((r) => [r.chapterId, r]));
  const list = chapters.filter((c) => (chapterId ? c.id === chapterId : by.has(c.id)));
  if (!rows.length)
    return (
      <EmptyState icon={<AudioLines className="size-8" />} title="尚未测量">
        运行<b>检查音频</b>以测量各已配音章节的响度与真峰值。
      </EmptyState>
    );
  const num = (n: number | null, unit: string) => (n === null ? "—" : `${n.toFixed(1)} ${unit}`);
  return (
    <div className="space-y-3">
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[30rem] text-sm">
          <thead className="muted text-left text-xs">
            <tr>
              <th className="p-2">章节</th>
              <th className="p-2 text-right">响度</th>
              <th className="p-2 text-right">响度范围</th>
              <th className="p-2 text-right">真峰值</th>
              <th className="p-2 text-right">测量日期</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const r = by.get(c.id);
              return (
                <tr key={c.id} className="border-t border-[var(--border)]">
                  <td className="p-2">
                    第 {c.order} 章 — {c.title}
                  </td>
                  <td className="p-2 text-right tabular-nums">{num(r?.lufs ?? null, "LUFS")}</td>
                  <td className="p-2 text-right tabular-nums">{num(r?.lra ?? null, "LU")}</td>
                  <td
                    className={clsx(
                      "p-2 text-right tabular-nums",
                      (r?.truePeakDb ?? -99) > -1 && "text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {num(r?.truePeakDb ?? null, "dBTP")}
                  </td>
                  <td className="muted p-2 text-right text-xs">
                    {r?.measuredAt ? new Date(r.measuredAt).toLocaleDateString("zh-CN") : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted text-xs">
        依据含停顿的旁白音频测量（EBU R128）。视频导出会将全片响度归一化为 -14 LUFS，峰值低于 -1.5 dBTP。
        各章响度应尽量接近，真峰值高于 -1 dBTP 时以琥珀色标记，表示归一化前已接近削波。
      </p>
    </div>
  );
}
