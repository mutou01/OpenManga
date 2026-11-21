import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, Download, ImagePlus, MonitorPlay, Share2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { get, patch, post } from "../../api/client.ts";
import { qk } from "../../api/hooks.ts";
import type { CastCard, JobListItem, ProjectOverview } from "../../api/types.ts";
import {
  AssetImage,
  ErrorBox,
  Field,
  fmt,
  KeyValue,
  Modal,
  PageHeader,
  Spinner,
  StatusChip,
  toast,
} from "../../components/ui.tsx";
import { colorModeLabel, projectTypeLabel, readingDirectionLabel } from "../../lib/locale.ts";
import { stylePresetText } from "../../lib/style-labels.ts";
import { AiChip, useAiBody } from "../ai/AiPicker.tsx";
import { kindLabel } from "../generation/shared.tsx";
import { ProfileCard } from "../profiles/ApplyProfile.tsx";
import { HealthCard } from "./HealthPage.tsx";
import { MembersDialog } from "./MembersDialog.tsx";
import { ProductionRunCard } from "./ProductionRun.tsx";
import { useProject, useProjectId } from "./ProjectLayout.tsx";
import { ShareDialog } from "./ShareDialog.tsx";

export function OverviewPage() {
  const projectId = useProjectId();
  const { data } = useProject();
  const jobs = useQuery({
    queryKey: [...qk.generations(projectId), "recent"],
    queryFn: () => get<{ jobs: JobListItem[] }>(`/projects/${projectId}/generations?limit=8`),
  });
  const cast = useQuery({
    queryKey: qk.cast(projectId),
    queryFn: () => get<{ characters: CastCard[] }>(`/projects/${projectId}/characters`),
  });
  const [coverOpen, setCoverOpen] = useState(false);
  const [thumbOpen, setThumbOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  if (!data) return null;
  const { project: p, counts, style } = data;
  const c = counts as Record<string, number>;
  const approvedCast =
    cast.data?.characters.filter((ch) => ch.referenceStatus === "approved" || ch.referenceStatus === "locked").length ??
    0;
  const steps: { done: boolean; label: string; to: string; hint: string }[] = [
    {
      done: (c.storyRevisions ?? 0) > 0,
      label: "添加故事",
      to: "/projects/$projectId/story",
      hint: "粘贴故事、章节、大纲、剧本或创意",
    },
    {
      done: (c.characters ?? 0) > 0,
      label: "分析并应用角色与世界设定",
      to: "/projects/$projectId/story",
      hint: "文本模型提取角色、场景和章节",
    },
    {
      done: approvedCast > 0 && approvedCast === (cast.data?.characters.length ?? -1),
      label: "制作并审核角色参考图",
      to: "/projects/$projectId/cast",
      hint: `${approvedCast}/${cast.data?.characters.length ?? 0} 个角色已通过审核`,
    },
    {
      done: (c.pages ?? 0) > 0,
      label: "将章节规划为场景、页面和画格",
      to: "/projects/$projectId/chapters",
      hint: `${c.chapters ?? 0} 章 · ${c.pages ?? 0} 页`,
    },
    {
      done: (c.panelsWithArt ?? 0) > 0,
      label: "审核画格并生成画面",
      to: "/projects/$projectId/pages",
      hint: `${c.panelsWithArt ?? 0}/${c.panels ?? 0} 格已有画面`,
    },
    {
      done: (c.narrationSegments ?? 0) > 0,
      label: "为页面排字并编写旁白",
      to: "/projects/$projectId/narration",
      hint: `${c.narrationSegments ?? 0} 段旁白`,
    },
    {
      done: false,
      label: "导出",
      to: "/projects/$projectId/exports",
      hint: "PNG、PDF、条漫、旁白或项目包",
    },
  ];
  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <PageHeader
        title={p.title}
        subtitle={p.description || "暂无简介"}
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => setMembersOpen(true)}>
              <Users className="size-4" /> 成员
            </button>
            {(data.role === "owner" || data.role === "admin") && (
              <button type="button" className="btn-secondary" onClick={() => setShareOpen(true)}>
                <Share2 className="size-4" /> 分享
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={() => setThumbOpen(true)}>
              <MonitorPlay className="size-4" /> 生成缩略图
            </button>
            <button type="button" className="btn-secondary" onClick={() => setCoverOpen(true)}>
              <ImagePlus className="size-4" /> 生成封面
            </button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["章节", c.chapters],
              ["页面", c.pages],
              ["画格", `${c.panelsWithArt ?? 0}/${c.panels ?? 0}`],
              ["角色", c.characters],
              ["场景", c.locations],
              ["生成次数", c.generations],
              ["进行中的任务", c.activeJobs],
              ["API 费用", fmt.usd(c.spendUsd)],
            ].map(([k, v]) => (
              <div key={String(k)} className="card p-3">
                <div className="muted text-xs">{k}</div>
                <div className="text-lg font-semibold">{v ?? 0}</div>
              </div>
            ))}
          </div>
          {data.disk && <DiskUsage disk={data.disk} />}
          <ReadinessCard
            projectId={projectId}
            budgetUsd={p.settings.budgetUsd ?? null}
            spentUsd={c.spendUsd ?? 0}
            unpricedCalls={c.unpricedCalls ?? 0}
          />
          <div className="card p-4">
            <h2 className="mb-3 font-medium">制作流程</h2>
            <ol className="space-y-2">
              {steps.map((s) => (
                <li key={s.label}>
                  <Link
                    to={s.to}
                    params={{ projectId }}
                    className="flex items-center gap-3 rounded-lg p-2 hover:bg-[var(--panel-2)]"
                  >
                    {s.done ? (
                      <CheckCircle2 className="size-5 text-emerald-500" />
                    ) : (
                      <Circle className="muted size-5" />
                    )}
                    <div>
                      <div className="text-sm font-medium">{s.label}</div>
                      <div className="muted text-xs">{s.hint}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium">最近的生成任务</h2>
              <Link
                to="/projects/$projectId/generation"
                params={{ projectId }}
                className="text-sm text-accent-500 hover:underline"
              >
                查看全部
              </Link>
            </div>
            {jobs.isLoading && <Spinner />}
            {jobs.data && !jobs.data.jobs.length && <p className="muted text-sm">暂无生成任务。</p>}
            <ul className="divide-y divide-[var(--border)]">
              {jobs.data?.jobs.map((j) => (
                <li key={j.id}>
                  <Link
                    to="/projects/$projectId/generation/$jobId"
                    params={{ projectId, jobId: j.id }}
                    className="flex items-center gap-3 py-2 text-sm hover:underline"
                  >
                    <AssetImage assetId={j.outputAssetId} alt="" className="size-10 rounded" />
                    <span className="flex-1 capitalize">{kindLabel(j.kind)}</span>
                    <span className="muted text-xs">
                      {fmt.usd(j.costUsd)} · {fmt.ago(j.createdAt)}
                    </span>
                    <StatusChip status={j.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <aside className="space-y-4">
          <HealthCard projectId={projectId} />
          <ProductionRunCard projectId={projectId} format={p.settings.format} />
          {p.settings.thumbnail && <ThumbnailCard projectId={projectId} saved={p.settings.thumbnail} />}
          <div className="card overflow-hidden">
            <AssetImage assetId={p.coverAssetId} variant={null} alt="封面插图" className="aspect-[2/3] w-full" />
            <div className="muted p-2 text-xs">生成的封面留空文字区域，标题在导出时合成。</div>
          </div>
          <ProfileCard projectId={projectId} from={p.settings.channelProfile} />
          <div className="card p-4">
            <h3 className="mb-2 text-sm font-medium">项目详情</h3>
            <KeyValue
              items={[
                [
                  "类型",
                  <span key="t" className="capitalize">
                    {projectTypeLabel(p.projectType)}
                  </span>,
                ],
                ["阅读方向", readingDirectionLabel(p.readingDirection)],
                ["色彩", colorModeLabel(p.colorMode)],
                ["画风", style?.preset ? stylePresetText(style.preset).name : "自定义"],
                ["作品语言", p.language],
                ["页面尺寸", `${p.settings.pageWidth}×${p.settings.pageHeight}`],
                ["图像质量", p.settings.imageQuality],
                ["创建时间", fmt.date(p.createdAt)],
              ]}
            />
          </div>
        </aside>
      </div>
      <CoverModal
        open={coverOpen}
        onClose={() => setCoverOpen(false)}
        projectId={projectId}
        title={p.title}
        cast={cast.data?.characters ?? []}
      />
      <ShareDialog projectId={projectId} open={shareOpen} onClose={() => setShareOpen(false)} />
      <MembersDialog projectId={projectId} open={membersOpen} onClose={() => setMembersOpen(false)} />
      <CoverModal
        thumbnail
        open={thumbOpen}
        onClose={() => setThumbOpen(false)}
        projectId={projectId}
        title={p.settings.thumbnail?.title || p.title}
        side={p.settings.thumbnailStyle?.side}
        cast={cast.data?.characters ?? []}
      />
    </div>
  );
}

type Thumbnail = { assetId: string; title: string; subtitle: string; side: "left" | "right" };

/** The video thumbnail with its headline composited live: rewording it redraws nothing and costs nothing. */
function ThumbnailCard({ projectId, saved }: { projectId: string; saved: Thumbnail }) {
  const qc = useQueryClient();
  const [t, setT] = useState(saved);
  const [shown, setShown] = useState(saved);
  // Keyed on the values: a refetch of the project returns a new but equal object, which must not wipe typing.
  useEffect(() => {
    setT(saved);
    setShown(saved);
  }, [saved.assetId, saved.title, saved.subtitle, saved.side]);
  // The preview follows typing after a pause, not on every key.
  useEffect(() => {
    const h = setTimeout(() => setShown(t), 500);
    return () => clearTimeout(h);
  }, [t]);
  const url = (download: boolean) =>
    `/api/projects/${projectId}/thumbnail.png?${new URLSearchParams({
      title: shown.title,
      subtitle: shown.subtitle,
      side: shown.side,
      v: saved.assetId,
      ...(download ? { download: "1" } : { width: "640" }),
    })}`;
  const dirty = t.title !== saved.title || t.subtitle !== saved.subtitle || t.side !== saved.side;
  return (
    <div className="card overflow-hidden">
      <img src={url(false)} alt="视频缩略图" className="aspect-video w-full bg-[var(--panel-2)] object-cover" />
      <div className="space-y-2 p-2">
        <input
          className="input"
          aria-label="主标题"
          placeholder="主标题"
          value={t.title}
          maxLength={120}
          onChange={(e) => setT({ ...t, title: e.target.value })}
        />
        <input
          className="input"
          aria-label="副标题"
          placeholder="副标题（可选）"
          value={t.subtitle}
          maxLength={120}
          onChange={(e) => setT({ ...t, subtitle: e.target.value })}
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            className="input w-auto"
            aria-label="标题位置"
            value={t.side}
            onChange={(e) => setT({ ...t, side: e.target.value as Thumbnail["side"] })}
          >
            <option value="left">标题居左</option>
            <option value="right">标题居右</option>
          </select>
          {dirty && (
            <button
              type="button"
              className="btn-secondary"
              onClick={async () => {
                try {
                  await patch(`/projects/${projectId}`, { settings: { thumbnail: t } });
                  await qc.invalidateQueries({ queryKey: qk.project(projectId), exact: true });
                } catch (e) {
                  toast.error(e);
                }
              }}
            >
              保存
            </button>
          )}
          <a className="btn-secondary ml-auto" href={url(true)}>
            <Download className="size-4" /> 1280×720 PNG
          </a>
        </div>
      </div>
    </div>
  );
}

function CoverModal({
  thumbnail,
  open,
  onClose,
  projectId,
  title,
  side: defaultSide = "left",
  cast,
}: {
  /** A 16:9 video thumbnail instead of the portrait cover. */
  thumbnail?: boolean;
  /** The headline side a new thumbnail starts with: the project's thumbnail style. */
  side?: "left" | "right";
  open: boolean;
  onClose: () => void;
  projectId: string;
  title: string;
  cast: CastCard[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title, subtitle: "", composition: "", characterIds: [] as string[] });
  const [side, setSide] = useState<"left" | "right">(defaultSide);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const aiImage = useAiBody("image");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={thumbnail ? "生成视频缩略图" : "生成封面"}
      footer={
        <>
          <AiChip cap="image" className="mr-auto" />
          <button type="button" className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await post(`/projects/${projectId}/${thumbnail ? "thumbnail" : "cover"}`, {
                  ...aiImage(),
                  ...form,
                  ...(thumbnail ? { side } : {}),
                });
                await qc.invalidateQueries({ queryKey: qk.generations(projectId) });
                toast.info(thumbnail ? "缩略图已加入生成队列" : "封面已加入生成队列");
                onClose();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner />} 生成
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {thumbnail && (
          <Field label="标题位置（插图会留出这一侧）">
            <select className="input" value={side} onChange={(e) => setSide(e.target.value as "left" | "right")}>
              <option value="left">左侧</option>
              <option value="right">右侧</option>
            </select>
          </Field>
        )}
        <Field label={thumbnail ? "主标题（由应用合成，之后可免费修改）" : "标题（由应用合成）"}>
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="副标题">
          <input
            className="input"
            value={form.subtitle}
            onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
          />
        </Field>
        <Field label="构图要求">
          <textarea
            className="input min-h-16"
            value={form.composition}
            onChange={(e) => setForm({ ...form, composition: e.target.value })}
            placeholder="例如：主角在前景，对手以剪影出现在后方，背景是雨夜中的城市"
          />
        </Field>
        <fieldset>
          <legend className="label">角色（已审核的参考图会以缩略图附上）</legend>
          <div className="flex flex-wrap gap-2">
            {cast.map((ch) => (
              <label key={ch.id} className="chip cursor-pointer bg-[var(--panel-2)] px-2 py-1 text-xs">
                <input
                  type="checkbox"
                  checked={form.characterIds.includes(ch.id)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      characterIds: e.target.checked
                        ? [...form.characterIds, ch.id]
                        : form.characterIds.filter((x) => x !== ch.id),
                    })
                  }
                />
                {ch.name}
              </label>
            ))}
          </div>
        </fieldset>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

type ReadinessIssue = {
  code: string;
  severity: "block" | "info";
  chapterLabel: string | null;
  message: string;
  area: string;
};

/** Export readiness + budget at a glance: what an export would ship incomplete right now. */
function ReadinessCard({
  projectId,
  budgetUsd,
  spentUsd,
  unpricedCalls,
}: {
  projectId: string;
  budgetUsd: number | null;
  spentUsd: number;
  unpricedCalls: number;
}) {
  const q = useQuery({
    queryKey: ["readiness", projectId, null, ""],
    queryFn: () =>
      get<{
        issues: ReadinessIssue[];
        language: string;
        credentials: { text: boolean; image: boolean; mockMode: boolean };
      }>(`/projects/${projectId}/readiness`),
  });
  const blocking = (q.data?.issues ?? []).filter((i) => i.severity === "block");
  return (
    <div className="card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-medium">导出就绪检查</h2>
        {budgetUsd !== null && (
          <span className={spentUsd >= budgetUsd ? "chip bg-red-500/15 text-red-600" : "chip"}>
            预算使用 {fmt.usd(spentUsd)} / {fmt.usd(budgetUsd)}
          </span>
        )}
        <Link to="/projects/$projectId/exports" params={{ projectId }} className="btn-ghost text-xs">
          导出
        </Link>
      </div>
      {unpricedCalls > 0 && (
        <p className="muted mb-2 text-sm">
          有 {unpricedCalls} 次调用缺少模型费率，实际花费可能超过显示金额，且预算上限可能无法触发。
        </p>
      )}
      {q.data?.credentials &&
        !q.data.credentials.mockMode &&
        !(q.data.credentials.text && q.data.credentials.image) && (
          <p className="mb-2 rounded-md bg-amber-500/10 p-2 text-sm text-amber-700 dark:text-amber-300">
            {!q.data.credentials.image ? "图像" : "文本"}生成缺少可用的 API 密钥。请先
            <Link to="/account" className="underline">
              添加你自己的密钥
            </Link>
            再生成。
          </p>
        )}
      {q.isLoading ? (
        <Spinner />
      ) : !blocking.length ? (
        <p className="text-sm text-emerald-600">所有章节均已有画面、旁白和音频。</p>
      ) : (
        <ul className="max-h-48 list-disc space-y-0.5 overflow-auto pl-5 text-sm text-amber-700 dark:text-amber-300">
          {blocking.map((i) => (
            <li key={`${i.code}-${i.chapterLabel}`}>
              {i.chapterLabel ? `${i.chapterLabel}: ` : ""}
              {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What the project's files take on disk: every stored original and derived copy, including the trash. */
function DiskUsage({ disk }: { disk: NonNullable<ProjectOverview["disk"]> }) {
  const parts: [string, number][] = [
    ["画面", disk.byCategory.artwork],
    ["参考图", disk.byCategory.references],
    ["旁白音频", disk.byCategory.narration],
    ["导出文件", disk.byCategory.exports],
    ["视频渲染缓存", disk.byCategory.renderCache],
    ["预览图与缩略图", disk.byCategory.derived],
  ];
  return (
    <div className="card flex flex-wrap items-baseline gap-x-4 gap-y-1 p-3">
      <div>
        <span className="muted text-xs">磁盘占用 </span>
        <span className="text-lg font-semibold">{fmt.bytes(disk.totalBytes)}</span>
      </div>
      <div className="muted flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {parts
          .filter(([, b]) => b > 0)
          .map(([label, b]) => (
            <span key={label}>
              {label} {fmt.bytes(b)}
            </span>
          ))}
        {disk.trashBytes > 0 && <span>· 回收站占用 {fmt.bytes(disk.trashBytes)}</span>}
      </div>
    </div>
  );
}
