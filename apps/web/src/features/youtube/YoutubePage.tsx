import { useQuery } from "@tanstack/react-query";
import { BarChart3, ExternalLink, Link2, Pencil, Plus, Trash2, TrendingUp, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { del, get, patch, post } from "../../api/client.ts";
import { useAction } from "../../api/hooks.ts";
import type { ExportListItem } from "../../api/types.ts";
import {
  ConfirmDialog,
  EmptyState,
  ErrorBox,
  Field,
  fmt,
  Modal,
  PageHeader,
  Spinner,
  Tabs,
  toast,
} from "../../components/ui.tsx";
import { useProject, useProjectId } from "../project/ProjectLayout.tsx";
import { BarChart, LineChart, ShareBars, seriesColor } from "./charts.tsx";

type Channel = {
  id: string;
  title: string;
  status: "active" | "revoked";
  reportingReady: boolean;
  reportingError: string | null;
  reportsCheckedAt: string | null;
};
type ChannelList = { enabled: boolean; mock: boolean; apiKey: boolean; channels: Channel[] };
type Counts = {
  views: number;
  likes: number | null;
  comments: number | null;
  asOf: string;
  source: "live" | "snapshot";
};
type LinkItem = {
  id: string;
  videoId: string;
  url: string;
  kind: "film" | "short";
  title: string;
  label: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  channelTitle: string | null;
  connection: { id: string; title: string | null; status: string | null } | null;
  exportId: string | null;
  exportFile: string | null;
  shortId: string | null;
  shortLabel: string | null;
  counts: Counts | null;
  impressions: number | null;
  curve48: (number | null)[] | null;
};
type Sum = { videos: number; views: number; likes: number; comments: number };
type Summary = {
  enabled: boolean;
  links: LinkItem[];
  totals: { all: Sum; film: Sum; short: Sum; byChannel: (Sum & { channelId: string; channelTitle: string | null })[] };
};
type Upload = { videoId: string; title: string; publishedAt: string | null };
type History = {
  source: "analytics" | "snapshots";
  daily: Record<string, number | string>[];
  tail: { after: string; views: number } | null;
  splits: Record<string, Record<string, number | string>[]> | null;
  analyticsError: string | null;
  live: Counts | null;
  reach: {
    daily: { day: string; impressions: number; ctr: number | null }[];
    bySource: { trafficSource: string; impressions: number }[];
  };
};

const channelsKey = ["youtube", "channels"] as const;
const summaryKey = (projectId: string) => ["project", projectId, "youtube"] as const;

/** Shows the outcome of Google's redirect back (?youtube_connected / ?youtube_error) once, then drops it from the URL. */
function useConnectOutcome() {
  useEffect(() => {
    const u = new URL(window.location.href);
    const ok = u.searchParams.get("youtube_connected");
    const err = u.searchParams.get("youtube_error");
    if (ok) toast.success(`已连接 ${ok}`);
    if (err) toast.error(new Error(err));
    if (ok || err) {
      u.searchParams.delete("youtube_connected");
      u.searchParams.delete("youtube_error");
      window.history.replaceState(null, "", u.toString());
    }
  }, []);
}

/** Connected YouTube channels: each its own read-only OAuth connection. */
export function YoutubeChannels({ returnTo }: { returnTo: string }) {
  useConnectOutcome();
  const q = useQuery({ queryKey: channelsKey, queryFn: () => get<ChannelList>("/youtube/channels") });
  const [removing, setRemoving] = useState<Channel | null>(null);
  const connect = useAction(() => post<{ url: string }>("/youtube/connect", { returnTo }), {
    onSuccess: (r) => window.location.assign(r.url),
  });
  const remove = useAction((id: string) => del(`/youtube/channels/${id}`), {
    invalidate: [channelsKey, ["project"]],
    success: "频道已断开连接",
    onSuccess: () => setRemoving(null),
  });
  const d = q.data;
  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">YouTube 频道</h2>
        {d?.enabled && (
          <button type="button" className="btn-secondary" onClick={() => connect.mutate()} disabled={connect.isPending}>
            {connect.isPending ? <Spinner /> : <Plus className="size-4" />} 连接频道
          </button>
        )}
      </div>
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {d && !d.enabled && (
        <p className="muted text-sm">
          此服务器尚未配置 YouTube 数据。请管理员注册 Google Cloud OAuth 客户端并设置 GOOGLE_OAUTH_CLIENT_ID 和
          GOOGLE_OAUTH_CLIENT_SECRET，详见部署指南。
        </p>
      )}
      {d?.enabled && (
        <p className="muted text-xs">
          连接频道仅授权读取观看次数、分析数据和覆盖情况。一个 Google 账号管理多个品牌频道时，请分别连接。
          {d.mock && " 模拟模式下，频道通过模拟 Google 授权页面连接。"}
        </p>
      )}
      {d?.channels.length === 0 && d.enabled && <p className="muted text-sm">尚未连接频道。</p>}
      <ul className="divide-y divide-[var(--border)] text-sm">
        {d?.channels.map((c) => (
          <li key={c.id} className="flex items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{c.title}</div>
              {c.status === "revoked" ? (
                <div className="text-xs text-red-700 dark:text-red-300">
                  Google 账号已撤销授权，请重新连接或断开连接。
                </div>
              ) : c.reportingError ? (
                <div className="text-xs text-amber-800 [overflow-wrap:anywhere] dark:text-amber-300">
                  曝光报告不可用 · {c.reportingError}
                </div>
              ) : (
                <div className="muted text-xs">
                  {c.reportingReady
                    ? `曝光报告${c.reportsCheckedAt ? `已检查 · ${fmt.ago(c.reportsCheckedAt)}` : "已配置"}`
                    : ""}
                </div>
              )}
            </div>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setRemoving(c)}
              aria-label={`断开 ${c.title} 的连接`}
            >
              <Unplug className="size-4" /> 断开连接
            </button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={Boolean(removing)}
        title={`断开 ${removing?.title ?? ""} 的连接？`}
        confirmLabel="断开连接"
        danger
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      >
        将撤销 Google 授权并删除此频道保存的曝光报告和授权数据快照。已关联的视频将保留，仅显示公开统计数据。
      </ConfirmDialog>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="muted text-xs">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="muted text-xs">{hint}</div>}
    </div>
  );
}

const sumHint = (s: Sum) => `${s.videos} 个视频 · ${fmt.num(s.likes)} 次点赞`;

/** Where a video came from: an export file of the project, or a Short of its repurposing plan. */
function SourcePicker({
  value,
  onChange,
}: {
  value: { exportId: string | null; shortId: string | null };
  onChange: (v: { exportId: string | null; shortId: string | null }) => void;
}) {
  const projectId = useProjectId();
  const project = useProject();
  const exports = useQuery({
    queryKey: ["project", projectId, "exports"],
    queryFn: () => get<{ jobs: ExportListItem[] }>(`/projects/${projectId}/exports`),
  });
  const files = (exports.data?.jobs ?? []).flatMap((j) => j.files.filter((f) => /video|youtube/.test(f.kind)));
  const shorts =
    (
      project.data?.project.settings as {
        repurpose?: { items?: { id: string; kind: string; label: string; title: string }[] };
      }
    )?.repurpose?.items ?? [];
  const current = value.exportId ? `e:${value.exportId}` : value.shortId ? `s:${value.shortId}` : "";
  return (
    <Field label="来源" hint="此视频对应的导出文件或内容再利用计划中的短视频。">
      <select
        className="input"
        value={current}
        onChange={(e) => {
          const v = e.target.value;
          onChange({
            exportId: v.startsWith("e:") ? v.slice(2) : null,
            shortId: v.startsWith("s:") ? v.slice(2) : null,
          });
        }}
      >
        <option value="">未记录</option>
        {shorts.length > 0 && (
          <optgroup label="内容再利用计划">
            {shorts.map((s) => (
              <option key={s.id} value={`s:${s.id}`}>
                {s.label || s.title || s.kind}
              </option>
            ))}
          </optgroup>
        )}
        {files.length > 0 && (
          <optgroup label="导出文件">
            {files.map((f) => (
              <option key={f.id} value={`e:${f.id}`}>
                {f.fileName}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </Field>
  );
}

function AddVideo({ open, onClose, linked }: { open: boolean; onClose: () => void; linked: Set<string> }) {
  const projectId = useProjectId();
  const [tab, setTab] = useState<"paste" | "uploads">("paste");
  const [video, setVideo] = useState("");
  const [kind, setKind] = useState<"" | "film" | "short">("");
  const [label, setLabel] = useState("");
  const [source, setSource] = useState<{ exportId: string | null; shortId: string | null }>({
    exportId: null,
    shortId: null,
  });
  const channels = useQuery({
    queryKey: channelsKey,
    queryFn: () => get<ChannelList>("/youtube/channels"),
    enabled: open,
  });
  const active = channels.data?.channels.filter((c) => c.status === "active") ?? [];
  const [channelId, setChannelId] = useState("");
  const chosen = channelId || active[0]?.id || "";
  const [pages, setPages] = useState<string[]>([""]);
  const uploads = useQuery({
    queryKey: ["youtube", "uploads", chosen, pages],
    queryFn: async () => {
      const all: Upload[] = [];
      let next: string | null = null;
      for (const token of pages) {
        const r: { items: Upload[]; next: string | null } = await get(
          `/youtube/channels/${chosen}/uploads${token ? `?pageToken=${encodeURIComponent(token)}` : ""}`,
        );
        all.push(...r.items);
        next = r.next;
      }
      return { items: all, next };
    },
    enabled: open && tab === "uploads" && Boolean(chosen),
  });
  const add = useAction(
    (v: string) =>
      post(`/projects/${projectId}/youtube/links`, {
        video: v,
        ...(kind ? { kind } : {}),
        label: label.trim(),
        ...source,
      }),
    {
      invalidate: [summaryKey(projectId)],
      success: "视频已关联",
      onSuccess: () => {
        setVideo("");
        setLabel("");
        if (tab === "paste") onClose();
      },
    },
  );
  return (
    <Modal open={open} onClose={onClose} title="关联 YouTube 视频">
      <div className="space-y-3">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "paste", label: "粘贴链接" },
            { value: "uploads", label: "从我的频道选择" },
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="类型" hint="自动识别时，/shorts/ 链接或不超过 3 分钟的视频视为短视频。">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="">自动识别</option>
              <option value="film">影片</option>
              <option value="short">短视频</option>
            </select>
          </Field>
          <Field label="标签（可选）">
            <input
              className="input"
              value={label}
              maxLength={120}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="例如，德语配音版"
            />
          </Field>
        </div>
        <SourcePicker value={source} onChange={setSource} />
        {tab === "paste" ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate(video);
            }}
          >
            <Field
              label="视频链接或 ID"
              hint="支持 watch?v=、youtu.be、/shorts/、/live/、/embed/ 链接或 11 位视频 ID。"
            >
              <input
                className="input"
                value={video}
                onChange={(e) => setVideo(e.target.value)}
                placeholder="https://youtu.be/…"
                required
                autoFocus
              />
            </Field>
            <button type="submit" className="btn-primary" disabled={add.isPending || !video.trim()}>
              {add.isPending ? <Spinner /> : <Link2 className="size-4" />} 关联视频
            </button>
          </form>
        ) : active.length === 0 ? (
          <p className="muted text-sm">请先连接频道，可前往“账号 → YouTube 频道”或在本页下方操作。</p>
        ) : (
          <div className="space-y-2">
            {active.length > 1 && (
              <select
                className="input"
                aria-label="频道"
                value={chosen}
                onChange={(e) => {
                  setChannelId(e.target.value);
                  setPages([""]);
                }}
              >
                {active.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            )}
            {uploads.error && <ErrorBox error={uploads.error} />}
            <ul className="max-h-80 divide-y divide-[var(--border)] overflow-y-auto rounded-lg border border-[var(--border)] text-sm">
              {uploads.data?.items.map((u) => (
                <li key={u.videoId} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{u.title}</div>
                    <div className="muted text-xs">
                      {u.publishedAt ? new Date(u.publishedAt).toLocaleDateString("zh-CN") : ""}
                    </div>
                  </div>
                  {linked.has(u.videoId) ? (
                    <span className="muted text-xs">已关联</span>
                  ) : (
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={add.isPending}
                      onClick={() => add.mutate(u.videoId)}
                    >
                      关联
                    </button>
                  )}
                </li>
              ))}
              {uploads.isLoading && (
                <li className="p-3">
                  <Spinner />
                </li>
              )}
            </ul>
            {uploads.data?.next && (
              <button type="button" className="btn-ghost" onClick={() => setPages([...pages, uploads.data!.next!])}>
                加载更多
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function EditLink({ link, onClose }: { link: LinkItem; onClose: () => void }) {
  const projectId = useProjectId();
  const [kind, setKind] = useState(link.kind);
  const [label, setLabel] = useState(link.label);
  const [source, setSource] = useState({ exportId: link.exportId, shortId: link.shortId });
  const save = useAction(() => patch(`/projects/${projectId}/youtube/links/${link.id}`, { kind, label, ...source }), {
    invalidate: [summaryKey(projectId)],
    success: "已保存",
    onSuccess: onClose,
  });
  return (
    <Modal open onClose={onClose} title={link.title || link.videoId}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="类型">
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as LinkItem["kind"])}>
            <option value="film">影片</option>
            <option value="short">短视频</option>
          </select>
        </Field>
        <Field label="标签">
          <input className="input" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <SourcePicker value={source} onChange={setSource} />
        <button type="submit" className="btn-primary" disabled={save.isPending}>
          {save.isPending && <Spinner />} 保存
        </button>
      </form>
    </Modal>
  );
}

const METRICS: [string, string][] = [
  ["views", "播放量"],
  ["estimatedMinutesWatched", "观看时长（分钟）"],
  ["averageViewDuration", "平均观看时长（秒）"],
  ["averageViewPercentage", "平均观看比例"],
  ["subscribersGained", "新增订阅人数"],
  ["subscribersLost", "流失订阅人数"],
  ["likes", "点赞数"],
  ["comments", "评论"],
  ["shares", "分享数"],
];
const SPLIT_LABELS: Record<string, string> = {
  trafficSource: "流量来源",
  country: "国家或地区",
  device: "设备",
  contentType: "短视频或长视频",
};
/** Reporting API traffic source codes, and the Analytics API's names made readable. */
const TRAFFIC: Record<string, string> = {
  "0": "直接访问或未知",
  "1": "YouTube 广告",
  "3": "浏览功能",
  "4": "频道页面",
  "5": "YouTube 搜索",
  "7": "推荐视频",
  "8": "其他 YouTube 功能",
  "9": "外部来源",
  "11": "卡片与注释",
  "14": "播放列表",
  "17": "通知",
  "18": "播放列表页面",
  "20": "片尾画面",
  "23": "动态",
  "24": "Shorts 信息流",
  "26": "话题标签页面",
  "27": "音频页面",
  "28": "直播重定向",
  "30": "混剪视频",
  "31": "竖屏直播信息流",
  "32": "相关视频",
  TV: "电视",
};
const readable = (k: string) =>
  TRAFFIC[k] ??
  k
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("zh-CN", { month: "short", day: "numeric", timeZone: "UTC" });

/** One video's history: opened on demand, so the Analytics API is only asked when someone looks. */
function VideoHistory({ link }: { link: LinkItem }) {
  const projectId = useProjectId();
  const [metric, setMetric] = useState("views");
  const q = useQuery({
    queryKey: ["project", projectId, "youtube", link.id, "history"],
    queryFn: () => get<History>(`/projects/${projectId}/youtube/links/${link.id}/history`),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const h = q.data!;
  const analytics = h.source === "analytics";
  const m = analytics ? metric : "views";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="muted text-xs">
          {analytics
            ? "每日数据来自 YouTube Analytics，延迟约 2 至 3 天。"
            : "根据保存的公开统计数据计算每日播放量，未连接频道的数据保留 30 天。"}
          {h.analyticsError && ` 分析数据不可用 · ${h.analyticsError}`}
        </div>
        {analytics && (
          <select className="input w-auto" aria-label="指标" value={metric} onChange={(e) => setMetric(e.target.value)}>
            {METRICS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        )}
      </div>
      {h.daily.length ? (
        <BarChart
          label={`每日${METRICS.find((x) => x[0] === m)?.[1]}`}
          points={h.daily.map((d) => ({ label: dayLabel(String(d.day)), value: Number(d[m] ?? 0) }))}
        />
      ) : (
        <p className="muted text-sm">暂无每日历史数据。</p>
      )}
      {h.tail && h.tail.views > 0 && (
        <p className="text-sm">
          <TrendingUp className="mr-1 inline size-4" />自 {dayLabel(h.tail.after)} 起新增 {fmt.num(h.tail.views)}{" "}
          次播放，来自实时统计数据。
        </p>
      )}
      {h.reach.daily.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h4 className="mb-1 text-sm font-medium">每日缩略图曝光量</h4>
            <BarChart
              label="每日缩略图曝光量"
              points={h.reach.daily.map((d) => ({ label: dayLabel(d.day), value: d.impressions }))}
            />
          </div>
          <div>
            <h4 className="mb-1 text-sm font-medium">每日点击率</h4>
            <LineChart
              label="每日缩略图点击率"
              series={[{ name: "点击率", values: h.reach.daily.map((d) => (d.ctr === null ? null : d.ctr * 100)) }]}
              xLabel={(i) => dayLabel(h.reach.daily[i]!.day)}
              fmt={(n) => `${n.toFixed(1)}%`}
            />
          </div>
        </div>
      )}
      {(h.splits || h.reach.bySource.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(h.splits ?? {}).map(([k, rows]) => (
            <div key={k}>
              <h4 className="mb-1 text-sm font-medium">{SPLIT_LABELS[k] ?? k}（播放量）</h4>
              <ShareBars
                rows={rows.map((r) => ({
                  key: k === "country" ? String(Object.values(r)[0]) : readable(String(Object.values(r)[0])),
                  value: Number(r.views ?? 0),
                }))}
              />
            </div>
          ))}
          {h.reach.bySource.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-medium">按流量来源统计曝光量</h4>
              <ShareBars
                rows={h.reach.bySource.map((r) => ({ key: readable(r.trafficSource), value: r.impressions }))}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function YoutubePage() {
  const projectId = useProjectId();
  const project = useProject();
  const canWrite = project.data?.role !== "viewer";
  const q = useQuery({
    queryKey: summaryKey(projectId),
    queryFn: () => get<Summary>(`/projects/${projectId}/youtube`),
  });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LinkItem | null>(null);
  const [unlinking, setUnlinking] = useState<LinkItem | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const unlink = useAction((id: string) => del(`/projects/${projectId}/youtube/links/${id}`), {
    invalidate: [summaryKey(projectId)],
    success: "视频已取消关联",
    onSuccess: () => setUnlinking(null),
  });
  const s = q.data;
  // Up to eight curves, newest first: a ninth colour would be a guess.
  const curves = (s?.links ?? []).filter((l) => l.curve48).slice(0, 8);
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <PageHeader
        title="YouTube 数据"
        subtitle="查看此项目已发布影片和短视频在各频道的表现。"
        actions={
          canWrite &&
          s?.enabled && (
            <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> 关联视频
            </button>
          )
        }
      />
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading && <Spinner />}
      {s && !s.links.length && (
        <EmptyState icon={<BarChart3 className="size-8" />} title="尚未关联视频">
          {s.enabled
            ? "从已连接频道的上传列表中选择已发布影片和短视频，或粘贴链接进行关联。"
            : "此服务器尚未配置 YouTube 数据。"}
        </EmptyState>
      )}
      {s && s.links.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="所有视频播放量" value={fmt.num(s.totals.all.views)} hint={sumHint(s.totals.all)} />
            <Stat label="影片" value={fmt.num(s.totals.film.views)} hint={sumHint(s.totals.film)} />
            <Stat label="Shorts" value={fmt.num(s.totals.short.views)} hint={sumHint(s.totals.short)} />
            <Stat label="评论" value={fmt.num(s.totals.all.comments)} hint={`${s.totals.byChannel.length} 个频道`} />
          </div>
          {s.totals.byChannel.length > 1 && (
            <section className="card overflow-x-auto p-4">
              <h2 className="mb-2 font-medium">按频道统计</h2>
              <table className="w-full text-sm">
                <thead className="muted text-xs">
                  <tr>
                    <th className="p-2 text-left font-normal">频道</th>
                    <th className="p-2 text-right font-normal">视频数</th>
                    <th className="p-2 text-right font-normal">播放量</th>
                    <th className="p-2 text-right font-normal">点赞数</th>
                  </tr>
                </thead>
                <tbody>
                  {s.totals.byChannel.map((c) => (
                    <tr key={c.channelId} className="border-t border-[var(--border)]">
                      <td className="p-2">{c.channelTitle ?? c.channelId}</td>
                      <td className="p-2 text-right tabular-nums">{c.videos}</td>
                      <td className="p-2 text-right tabular-nums">{fmt.num(c.views)}</td>
                      <td className="p-2 text-right tabular-nums">{fmt.num(c.likes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {curves.length > 0 && (
            <section className="card p-4">
              <h2 className="font-medium">发布后 48 小时</h2>
              <p className="muted mb-2 text-xs">
                根据公开统计数据的每小时快照展示发布后的播放量，空缺表示未采集到数据。
              </p>
              <LineChart
                label="各视频发布后 48 小时播放量"
                series={curves.map((l) => ({ name: l.label || l.title || l.videoId, values: l.curve48! }))}
                xLabel={(i) => `${i} 小时`}
              />
            </section>
          )}
          <section className="card divide-y divide-[var(--border)]">
            {s.links.map((l) => (
              <div key={l.id} className="p-3 sm:p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        {curves.includes(l) && (
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ background: seriesColor(curves.indexOf(l)) }}
                          />
                        )}
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 truncate font-medium hover:underline"
                        >
                          {l.title || l.videoId}
                        </a>
                      </span>
                      <span className="chip">{l.kind === "short" ? "短视频" : "影片"}</span>
                      {l.label && <span className="chip">{l.label}</span>}
                    </div>
                    <div className="muted mt-0.5 text-xs [overflow-wrap:anywhere]">
                      {l.channelTitle ?? "未知频道"}
                      {l.connection ? " · 已连接" : " · 公开统计数据"}
                      {l.publishedAt && ` · 发布于 ${fmt.date(l.publishedAt)}`}
                      {(l.shortLabel || l.exportFile) && ` · 来源 ${l.shortLabel ?? l.exportFile}`}
                    </div>
                  </div>
                  <div className="flex gap-4 text-right text-sm tabular-nums">
                    <div>
                      <div className="font-semibold">{l.counts ? fmt.num(l.counts.views) : "—"}</div>
                      <div className="muted text-xs">播放量</div>
                    </div>
                    <div>
                      <div>{fmt.num(l.counts?.likes)}</div>
                      <div className="muted text-xs">点赞数</div>
                    </div>
                    {l.impressions !== null && (
                      <div>
                        <div>{fmt.num(l.impressions)}</div>
                        <div className="muted text-xs">曝光量</div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <button
                    type="button"
                    className="btn-ghost"
                    aria-expanded={open === l.id}
                    onClick={() => setOpen(open === l.id ? null : l.id)}
                  >
                    <BarChart3 className="size-4" /> {open === l.id ? "收起图表" : "图表"}
                  </button>
                  <a className="btn-ghost" href={l.url} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" /> YouTube
                  </a>
                  {canWrite && (
                    <>
                      <button type="button" className="btn-ghost" onClick={() => setEditing(l)}>
                        <Pencil className="size-4" /> 编辑
                      </button>
                      <button type="button" className="btn-ghost" onClick={() => setUnlinking(l)}>
                        <Trash2 className="size-4" /> 取消关联
                      </button>
                    </>
                  )}
                </div>
                {open === l.id && (
                  <div className="mt-3">
                    <VideoHistory link={l} />
                  </div>
                )}
              </div>
            ))}
          </section>
          <p className="muted text-xs">
            统计数据实时读取，两次读取至少间隔 5 分钟。数据保存遵循 YouTube 开发者政策，未连接频道的公开统计数据保留 30
            天。
          </p>
        </>
      )}
      {canWrite && s?.enabled && <YoutubeChannels returnTo={`/projects/${projectId}/youtube`} />}
      <AddVideo open={adding} onClose={() => setAdding(false)} linked={new Set(s?.links.map((l) => l.videoId))} />
      {editing && <EditLink link={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={Boolean(unlinking)}
        title="取消关联此视频？"
        confirmLabel="取消关联"
        danger
        busy={unlink.isPending}
        onConfirm={() => unlinking && unlink.mutate(unlinking.id)}
        onClose={() => setUnlinking(null)}
      >
        取消关联后，此处将停止展示该视频的数据。YouTube 上的视频和数据保持原状。
      </ConfirmDialog>
    </div>
  );
}
