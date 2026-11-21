import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { get, post } from "../../api/client.ts";
import type { JobDetail, StoryAnalysisRow, StylePresetRow } from "../../api/types.ts";
import { clsx, ErrorBox, Field, PageHeader, Spinner } from "../../components/ui.tsx";
import { colorModeLabel, formatLabel, projectTypeLabel, readingDirectionLabel, UI_LOCALE } from "../../lib/locale.ts";
import { stylePresetText } from "../../lib/style-labels.ts";
import { AiChip, useAiBody } from "../ai/AiPicker.tsx";
import { useProfiles } from "../profiles/ApplyProfile.tsx";
import { AnalysisReview } from "../story/AnalysisReview.tsx";

const TYPES = ["manhwa", "manga", "webtoon", "comic", "illustrated_story"] as const;
const INPUT_KINDS = [
  { value: "story", label: "故事" },
  { value: "chapter", label: "章节" },
  { value: "outline", label: "大纲" },
  { value: "screenplay", label: "剧本" },
  { value: "idea", label: "创意" },
] as const;
const STEPS = ["项目", "故事", "分析", "审核"];

export function NewProjectWizard() {
  const aiText = useAiBody("text");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const presets = useQuery({
    queryKey: ["style-presets"],
    queryFn: () => get<{ presets: StylePresetRow[] }>("/style-presets"),
  });
  const [step, setStep] = useState(0);
  const [details, setDetails] = useState({
    title: "",
    description: "",
    projectType: "manhwa",
    language: "en",
    readingDirection: "",
    colorMode: "full_color",
    stylePresetKey: "manhwa",
    customStyle: "",
    format: "comic",
  });
  const [story, setStory] = useState({ inputKind: "story", title: "", content: "" });
  // A production preset or saved template seeds the fields below and, on creation, the project's settings.
  const production = useQuery({
    queryKey: ["production-presets"],
    queryFn: () =>
      get<{
        presets: {
          key: string;
          name: string;
          description: string;
          projectType: string;
          format: string;
          stylePresetKey: string;
          colorMode: string;
        }[];
        templates: {
          id: string;
          name: string;
          projectType: string;
          format: string;
          stylePresetKey?: string | null;
          customStyle: string;
          colorMode: string;
          language: string;
          readingDirection?: string;
        }[];
      }>("/production-presets"),
  });
  const [preset, setPreset] = useState<string | null>(null);
  /** Selects a preset or "template:<id>" and fills the fields it sets; unknown keys (a deleted template) do nothing. */
  const choosePreset = (key: string | null) => {
    setPreset(key);
    const p = production.data?.presets.find((x) => x.key === key);
    const t = production.data?.templates.find((x) => `template:${x.id}` === key);
    if (p)
      setDetails((d) => ({
        ...d,
        projectType: p.projectType,
        format: p.format,
        stylePresetKey: p.stylePresetKey,
        colorMode: p.colorMode,
      }));
    else if (t)
      setDetails((d) => ({
        ...d,
        projectType: t.projectType,
        format: t.format,
        stylePresetKey: t.stylePresetKey ?? d.stylePresetKey,
        customStyle: t.customStyle,
        colorMode: t.colorMode,
        language: t.language,
        readingDirection: t.readingDirection ?? "",
      }));
    else setPreset(null);
  };
  // A channel profile goes on top: its voice, branding and rules are copied in at creation, after its preset.
  const profiles = useProfiles();
  const search = useSearch({ strict: false }) as { profile?: string };
  const [profileId, setProfileId] = useState<string | null>(null);
  const chooseProfile = (id: string | null) => {
    const pr = profiles.data?.profiles.find((x) => x.id === id);
    setProfileId(pr?.id ?? null);
    if (pr?.preset) choosePreset(pr.preset);
  };
  // Profiles → New project arrives with ?profile=; it is chosen once both lists have loaded.
  useEffect(() => {
    if (search.profile && profiles.data && production.data && profileId === null) chooseProfile(search.profile);
  }, [profiles.data, production.data]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => get<JobDetail>(`/generations/${jobId}`),
    enabled: Boolean(jobId),
    refetchInterval: (q) =>
      q.state.data && ["completed", "failed", "cancelled"].includes(q.state.data.job.status) ? false : 1500,
  });
  const analysis = useQuery({
    queryKey: ["analysis", analysisId, job.data?.job.status],
    queryFn: () => get<{ analysis: StoryAnalysisRow }>(`/story-analyses/${analysisId}`),
    enabled: Boolean(analysisId) && job.data?.job.status === "completed",
  });

  const setD = (k: keyof typeof details) => (e: { target: { value: string } }) =>
    setDetails((d) => ({ ...d, [k]: e.target.value }));

  const createAndAnalyze = async (analyze: boolean) => {
    setBusy(true);
    setError(null);
    try {
      let pid = projectId;
      if (!pid) {
        const r = await post<{ project: { id: string } }>("/projects", {
          ...details,
          // "film-9:16" is a film project of vertical shots.
          ...(details.format === "film-9:16" ? { format: "film", filmFrame: "9:16" } : {}),
          ...(preset ? { preset } : {}),
          ...(profileId ? { profileId } : {}),
          readingDirection: details.readingDirection || undefined,
          story: story.content.trim()
            ? { content: story.content, inputKind: story.inputKind, title: story.title }
            : undefined,
        });
        pid = r.project.id;
        setProjectId(pid);
        await qc.invalidateQueries({ queryKey: ["projects"] });
      }
      if (!analyze || !story.content.trim()) {
        navigate({ to: "/projects/$projectId", params: { projectId: pid } });
        return;
      }
      const s = await get<{ latest: { id: string } }>(`/projects/${pid}/story`);
      const a = await post<{ job: { id: string }; analysis: { id: string } }>(
        `/story-revisions/${s.latest.id}/analyze`,
        aiText(),
      );
      setJobId(a.job.id);
      setAnalysisId(a.analysis.id);
      setStep(2);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const status = job.data?.job.status;
  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <PageHeader title="新建项目" subtitle="你可以在每个阶段检查和调整内容。" />
      <ol className="mb-6 flex flex-wrap gap-2" aria-label="向导步骤">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={clsx(
              "chip px-3 py-1 text-xs",
              i === step ? "bg-accent-600 text-white" : i < step ? "bg-accent-600/20" : "bg-[var(--panel-2)] muted",
            )}
            aria-current={i === step ? "step" : undefined}
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      <ErrorBox error={error} />

      {step === 0 && (
        <div className="card space-y-4 p-5">
          {profiles.data && (
            <Field
              label="频道配置"
              hint={
                <>
                  将频道的旁白、品牌、标志、缩略图、YouTube 规则和导出规格复制到项目。下方的预设或模板决定项目类型。{" "}
                  <Link to="/profiles" className="text-accent-500 hover:underline">
                    管理频道配置
                  </Link>
                </>
              }
            >
              <select className="input" value={profileId ?? ""} onChange={(e) => chooseProfile(e.target.value || null)}>
                <option value="">无</option>
                {profiles.data.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {production.data && (
            <fieldset>
              <legend className="label">起始方式</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  aria-pressed={!preset}
                  className={clsx("card p-3 text-left text-sm", !preset && "ring-2 ring-accent-500")}
                  onClick={() => choosePreset(null)}
                >
                  <div className="font-medium">空白项目</div>
                  <div className="muted text-xs">自行填写下方选项。</div>
                </button>
                {production.data.presets.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    aria-pressed={preset === p.key}
                    className={clsx("card p-3 text-left text-sm", preset === p.key && "ring-2 ring-accent-500")}
                    onClick={() => choosePreset(p.key)}
                  >
                    <div className="font-medium">{p.name}</div>
                    <div className="muted text-xs">{p.description}</div>
                  </button>
                ))}
                {production.data.templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={preset === `template:${t.id}`}
                    className={clsx(
                      "card p-3 text-left text-sm",
                      preset === `template:${t.id}` && "ring-2 ring-accent-500",
                    )}
                    onClick={() => choosePreset(`template:${t.id}`)}
                  >
                    <div className="font-medium">{t.name}</div>
                    <div className="muted text-xs">
                      自定义模板 · {formatLabel(t.format)} · {projectTypeLabel(t.projectType)}
                    </div>
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="标题">
              <input
                className="input"
                value={details.title}
                onChange={setD("title")}
                required
                autoFocus
                maxLength={200}
              />
            </Field>
            <Field
              label="作品形式"
              hint={
                details.format === "film"
                  ? "每页是一个 16:9 镜头，可规划镜头清单并导出带运镜和旁白的视频。创建页面后无法更改。"
                  : details.format === "film-9:16"
                    ? "每页是一个 9:16 竖屏镜头，适用于 Shorts 和手机，可直接渲染为竖屏视频。创建页面后无法更改。"
                    : details.format === "vertical"
                      ? "画格沿单列连续滚动，可添加对白和说明文字，并设置留白、无缝、重叠或渐变过渡。创建页面后无法更改。"
                      : "每页 1–5 格，支持排字，可导出为单页、PDF 或条漫。"
              }
            >
              <select className="input" value={details.format} onChange={setD("format")}>
                <option value="comic">{formatLabel("comic")}</option>
                <option value="vertical">{formatLabel("vertical")}</option>
                <option value="film">{formatLabel("film")}</option>
                <option value="film-9:16">{formatLabel("film-9:16")}</option>
              </select>
            </Field>
            <Field label="项目类型">
              <select className="input" value={details.projectType} onChange={setD("projectType")}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {projectTypeLabel(t)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="作品语言">
              <input className="input" value={details.language} onChange={setD("language")} maxLength={16} />
            </Field>
            <Field label="阅读方向" hint="默认：日式漫画从右到左，条漫竖向阅读，其余从左到右。">
              <select className="input" value={details.readingDirection} onChange={setD("readingDirection")}>
                <option value="">按类型使用默认值</option>
                <option value="ltr">{readingDirectionLabel("ltr")}</option>
                <option value="rtl">{readingDirectionLabel("rtl")}</option>
                <option value="vertical">{readingDirectionLabel("vertical")}</option>
              </select>
            </Field>
            <Field label="色彩模式">
              <select className="input" value={details.colorMode} onChange={setD("colorMode")}>
                <option value="full_color">{colorModeLabel("full_color")}</option>
                <option value="grayscale">{colorModeLabel("grayscale")}</option>
                <option value="bw_manga">{colorModeLabel("bw_manga")}</option>
              </select>
            </Field>
          </div>
          <Field label="简介">
            <textarea
              className="input min-h-16"
              value={details.description}
              onChange={setD("description")}
              maxLength={5000}
            />
          </Field>
          <div>
            <span className="label">默认画风</span>
            {presets.isLoading && <Spinner />}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {presets.data?.presets.map((p) => {
                const { name, summary } = stylePresetText(p);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setDetails((d) => ({ ...d, stylePresetKey: p.key }))}
                    className={clsx(
                      "rounded-lg border p-3 text-left text-sm",
                      details.stylePresetKey === p.key
                        ? "border-accent-500 bg-accent-600/10"
                        : "border-[var(--border)] hover:bg-[var(--panel-2)]",
                    )}
                    aria-pressed={details.stylePresetKey === p.key}
                  >
                    <div className="font-medium">{name}</div>
                    <div className="muted mt-0.5 line-clamp-2 text-xs">{summary}</div>
                  </button>
                );
              })}
            </div>
          </div>
          <Field label="自定义画风说明（可选）">
            <textarea
              className="input min-h-14"
              value={details.customStyle}
              onChange={setD("customStyle")}
              placeholder="例如：低饱和青绿色调、暴雨氛围、细线稿"
            />
          </Field>
          <div className="flex justify-end">
            <button type="button" className="btn-primary" disabled={!details.title.trim()} onClick={() => setStep(1)}>
              下一步 <ArrowRight className="size-4" />
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="card space-y-4 p-5">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="输入类型">
            {INPUT_KINDS.map((k) => (
              // biome-ignore lint/a11y/useSemanticElements: styled segmented control with radio semantics
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={story.inputKind === k.value}
                onClick={() => setStory((s) => ({ ...s, inputKind: k.value }))}
                className={clsx("btn", story.inputKind === k.value ? "bg-accent-600 text-white" : "btn-secondary")}
              >
                {k.label}
              </button>
            ))}
          </div>
          <Field label="标题（可选）">
            <input
              className="input"
              value={story.title}
              onChange={(e) => setStory((s) => ({ ...s, title: e.target.value }))}
            />
          </Field>
          <Field
            label={`粘贴${INPUT_KINDS.find((kind) => kind.value === story.inputKind)?.label ?? "内容"}`}
            hint={`${story.content.length.toLocaleString(UI_LOCALE)} 个字符 · 保存为版本 1`}
          >
            <textarea
              className="input min-h-80 font-mono text-sm leading-relaxed"
              value={story.content}
              onChange={(e) => setStory((s) => ({ ...s, content: e.target.value }))}
              placeholder="第一章&#10;&#10;宇镇冒雨爬上了天台……"
            />
          </Field>
          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" className="btn-secondary" onClick={() => setStep(0)}>
              <ArrowLeft className="size-4" /> 返回
            </button>
            <div className="flex items-center gap-2">
              <AiChip cap="text" />
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => createAndAnalyze(false)}>
                直接创建
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy || !story.content.trim()}
                onClick={() => createAndAnalyze(true)}
              >
                {busy ? <Spinner /> : <Sparkles className="size-4" />} 创建并分析
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card space-y-4 p-5">
          {(!status || status === "queued" || status === "processing") && (
            <div className="flex items-center gap-3">
              <Spinner className="size-5" />
              <div>
                <div className="font-medium">正在分析故事…</div>
                <div className="muted text-sm">
                  正在提取题材、角色及别名、世界设定、场景、道具、情节节点和章节。 状态：
                  {status === "processing" ? "处理中" : "排队中"}
                </div>
              </div>
            </div>
          )}
          {status === "failed" && (
            <>
              <ErrorBox error={new Error(job.data?.job.failureReason ?? "分析失败")} title="故事分析失败" />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={async () => {
                    try {
                      const r = await post<{ job: { id: string } }>(`/generations/${jobId}/retry`);
                      setJobId(r.job.id);
                    } catch (e) {
                      setError(e);
                    }
                  }}
                >
                  重试分析
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => projectId && navigate({ to: "/projects/$projectId/story", params: { projectId } })}
                >
                  编辑故事
                </button>
              </div>
            </>
          )}
          {status === "completed" && analysis.data && (
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm">分析完成。请先审核或编辑提取结果，再应用到项目。</div>
              <button type="button" className="btn-primary" onClick={() => setStep(3)}>
                审核 <ArrowRight className="size-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {step === 3 && analysis.data && projectId && (
        <AnalysisReview
          analysis={analysis.data.analysis}
          projectId={projectId}
          onApplied={() => navigate({ to: "/projects/$projectId", params: { projectId } })}
        />
      )}
    </div>
  );
}
