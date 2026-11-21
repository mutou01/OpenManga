import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { BookCopy, Link2Off, Plus, RefreshCw, Scissors, Search } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { del, get, patch, post } from "../../api/client.ts";
import { useAction } from "../../api/hooks.ts";
import {
  ConfirmDialog,
  EmptyState,
  ErrorBox,
  Field,
  fmt,
  PageHeader,
  Spinner,
  StatusChip,
  toast,
} from "../../components/ui.tsx";

type SeriesItem = { id: string; title: string; description: string; episodes: number; libraryProjectId: string };
type Episode = {
  id: string;
  title: string;
  episodeNumber: number;
  status: string;
  chapters: number;
  panels: number;
  panelsDrawn: number;
  spendUsd: number;
  exports: number;
  openComments: number;
  behind: number;
};
type Dashboard = {
  series: SeriesItem & {
    channelProfileId: string | null;
    visibility: "off" | "unlisted" | "public";
    publicSlug: string | null;
  };
  library: { projectId: string; characters: number; locations: number; props: number; facts: number };
  episodes: Episode[];
  totals: {
    episodes: number;
    panels: number;
    panelsDrawn: number;
    spendUsd: number;
    exports: number;
    openComments: number;
    behind: number;
  };
};
type Profile = { id: string; name: string };

const useProfiles = () =>
  useQuery({ queryKey: ["channel-profiles"], queryFn: () => get<{ profiles: Profile[] }>("/channel-profiles") });

/** Every series of the user's, and a form to start one. */
export function SeriesListPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["series"], queryFn: () => get<{ series: SeriesItem[] }>("/series") });
  const profiles = useProfiles();
  const [title, setTitle] = useState("");
  const [profileId, setProfileId] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await post("/series", { title: title.trim(), channelProfileId: profileId || null });
      setTitle("");
      await qc.invalidateQueries({ queryKey: ["series"] });
      toast.success("系列已创建");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <PageHeader title="系列" subtitle="各集共享角色、场景、道具、风格、故事设定集和频道配置。" />
      <form className="card mb-6 flex flex-wrap items-end gap-3 p-4" onSubmit={(e) => void create(e)}>
        <Field label="新建系列">
          <input
            className="input w-72 max-w-full"
            placeholder="标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="频道配置">
          <select className="input" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            <option value="">无</option>
            {profiles.data?.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit" className="btn-primary" disabled={busy || !title.trim()}>
          {busy ? <Spinner /> : <Plus className="size-4" />} 创建
        </button>
      </form>
      <ErrorBox error={q.error} />
      {q.isLoading && <Spinner />}
      {q.data && !q.data.series.length && (
        <EmptyState title="暂无系列">创建系列后，可添加新剧集或纳入已有项目。</EmptyState>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {q.data?.series.map((s) => (
          <li key={s.id}>
            <Link
              to="/series/$seriesId"
              params={{ seriesId: s.id }}
              className="card block p-4 hover:bg-[var(--panel-2)]"
            >
              <div className="font-medium">{s.title}</div>
              <div className="muted text-sm">
                {s.episodes} 集{s.description && ` · ${s.description}`}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One series: its episodes at a glance, the shared library, and the tools to grow and sync it. */
export function SeriesDetailPage() {
  const { seriesId } = useParams({ strict: false }) as { seriesId: string };
  const qc = useQueryClient();
  const key = ["series", seriesId] as const;
  const q = useQuery({ queryKey: key, queryFn: () => get<Dashboard>(`/series/${seriesId}`) });
  const [busy, setBusy] = useState(false);
  const [detach, setDetach] = useState<Episode | null>(null);
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: key });
      if (done) toast.success(done);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  if (q.isLoading) return <Spinner className="m-6" />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const { series: s, library: lib, episodes, totals } = q.data;
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title={s.title}
        subtitle={s.description || "各集共享同一资源库。"}
        actions={
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || !episodes.length}
              onClick={() => void run(() => post(`/series/${s.id}/sync`, {}), "所有剧集已与资源库同步")}
            >
              <RefreshCw className="size-4" /> 全部同步
            </button>
            <SeriesSettings dashboard={q.data} onSaved={() => void qc.invalidateQueries({ queryKey: key })} />
          </>
        }
      />

      <section aria-label="总计" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["剧集", totals.episodes],
          ["已绘制画格", `${totals.panelsDrawn} / ${totals.panels}`],
          ["费用", `$${totals.spendUsd.toFixed(2)}`],
          ["导出", totals.exports],
          ["待处理评论", totals.openComments],
        ].map(([label, value]) => (
          <div key={label} className="card p-3">
            <div className="muted text-xs">{label}</div>
            <div className="text-lg font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </section>

      <ReaderPage
        key={`${q.data.series.visibility}-${q.data.series.publicSlug}`}
        dashboard={q.data}
        onSaved={() => void qc.invalidateQueries({ queryKey: key })}
      />

      <section aria-label="资源库" className="card space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <BookCopy className="size-4" />
          <h2 className="font-medium">资源库</h2>
          <span className="muted text-sm">
            {lib.characters} 个角色 · {lib.locations} 个场景 · {lib.props} 个道具 · {lib.facts} 条故事设定
          </span>
        </div>
        <p className="muted text-sm">在此编辑共享角色与世界设定。同步后各集会使用这些设定及相同的参考图。</p>
        <div className="flex flex-wrap gap-2 text-sm">
          {(
            [
              ["角色", "/projects/$projectId/cast"],
              ["世界设定与风格", "/projects/$projectId/world"],
              ["故事设定集", "/projects/$projectId/bible"],
            ] as const
          ).map(([label, to]) => (
            <Link key={label} className="btn-secondary" to={to} params={{ projectId: lib.projectId }}>
              {label}
            </Link>
          ))}
        </div>
      </section>

      <section aria-label="剧集" className="space-y-2">
        <h2 className="font-medium">剧集</h2>
        {!episodes.length && <p className="muted text-sm">暂无剧集。可添加新剧集、纳入项目或拆分故事。</p>}
        {episodes.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead className="muted text-left text-xs">
                <tr className="[&>th]:px-3 [&>th]:py-2">
                  <th>#</th>
                  <th>剧集</th>
                  <th>状态</th>
                  <th className="text-right">已绘制</th>
                  <th className="text-right">费用</th>
                  <th className="text-right">导出</th>
                  <th className="text-right">评论</th>
                  <th>资源库</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {episodes.map((e) => (
                  <tr key={e.id} className="[&>td]:px-3 [&>td]:py-2">
                    <td className="tabular-nums">{e.episodeNumber}</td>
                    <td>
                      <Link className="link" to="/projects/$projectId" params={{ projectId: e.id }}>
                        {e.title}
                      </Link>
                      <div className="muted text-xs">{e.chapters} 章</div>
                    </td>
                    <td>
                      <StatusChip status={e.status} />
                    </td>
                    <td className="text-right tabular-nums">
                      {e.panelsDrawn} / {e.panels}
                    </td>
                    <td className="text-right tabular-nums">${e.spendUsd.toFixed(2)}</td>
                    <td className="text-right tabular-nums">{e.exports}</td>
                    <td className="text-right tabular-nums">{e.openComments}</td>
                    <td>
                      {e.behind ? (
                        <button
                          type="button"
                          className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300"
                          title="此集尚未同步的资源库条目、风格或设定，点击即可同步。"
                          disabled={busy}
                          onClick={() =>
                            void run(() => post(`/series/${s.id}/sync`, { projectId: e.id }), "此集已同步")
                          }
                        >
                          {e.behind} 项未同步 · 同步
                        </button>
                      ) : (
                        <span className="chip bg-emerald-500/15 text-emerald-600">已同步</span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-ghost p-1"
                        aria-label={`将 ${e.title} 移出系列`}
                        title="从系列中移除"
                        onClick={() => setDetach(e)}
                      >
                        <Link2Off className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <AddEpisode seriesId={s.id} onDone={() => void qc.invalidateQueries({ queryKey: key })} />
        <AdoptProject seriesId={s.id} onDone={() => void qc.invalidateQueries({ queryKey: key })} />
        <SplitStory seriesId={s.id} onDone={() => void qc.invalidateQueries({ queryKey: key })} />
        <Appearances seriesId={s.id} libraryId={lib.projectId} />
      </div>

      <ConfirmDialog
        open={Boolean(detach)}
        title={`将“${detach?.title}”移出系列？`}
        confirmLabel="移出系列"
        onClose={() => setDetach(null)}
        onConfirm={() =>
          void run(
            () => post(`/series/${s.id}/episodes/${detach!.id}/detach`, {}).then(() => setDetach(null)),
            "已移出系列",
          )
        }
      >
        移出后会保留独立的角色和世界设定，并停止与资源库同步。
      </ConfirmDialog>
    </div>
  );
}

function SeriesSettings({ dashboard, onSaved }: { dashboard: Dashboard; onSaved: () => void }) {
  const profiles = useProfiles();
  const s = dashboard.series;
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <>
      <select
        className="input w-48"
        aria-label="频道配置"
        value={s.channelProfileId ?? ""}
        onChange={(e) =>
          void patch(`/series/${s.id}`, { channelProfileId: e.target.value || null })
            .then(onSaved)
            .catch(toast.error)
        }
      >
        <option value="">无频道配置</option>
        {profiles.data?.profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {!dashboard.episodes.length && (
        <button type="button" className="btn-ghost text-red-600" onClick={() => setConfirmDelete(true)}>
          删除
        </button>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={`删除“${s.title}”？`}
        confirmLabel="删除系列"
        danger
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          void del(`/series/${s.id}`)
            .then(() => {
              window.location.assign(`${import.meta.env.BASE_URL}series`);
            })
            .catch(toast.error)
        }
      >
        资源库项目将移至回收站。
      </ConfirmDialog>
    </>
  );
}

function AddEpisode({ seriesId, onDone }: { seriesId: string; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [story, setStory] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`/series/${seriesId}/episodes`, {
        title: title.trim(),
        ...(story.trim() ? { story: { content: story, inputKind: "story" } } : {}),
      });
      setTitle("");
      setStory("");
      onDone();
      toast.success("已添加剧集并关联资源库");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form aria-label="添加剧集" className="card space-y-2 p-4" onSubmit={(e) => void add(e)}>
      <h3 className="font-medium">添加剧集</h3>
      <Field label="标题">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="故事（可选）">
        <textarea className="input min-h-20 text-sm" value={story} onChange={(e) => setStory(e.target.value)} />
      </Field>
      <button type="submit" className="btn-primary" disabled={busy || !title.trim()}>
        {busy ? <Spinner /> : <Plus className="size-4" />} 添加分集
      </button>
    </form>
  );
}

function AdoptProject({ seriesId, onDone }: { seriesId: string; onDone: () => void }) {
  const projects = useQuery({
    queryKey: ["projects", "adoptable"],
    queryFn: () =>
      get<{ projects: { id: string; title: string; seriesId: string | null; role: string }[] }>("/projects"),
  });
  const [projectId, setProjectId] = useState("");
  const [applyProfile, setApplyProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  const free = projects.data?.projects.filter((p) => !p.seriesId && p.role === "owner") ?? [];
  const adopt = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await post<{ synced: { linked: number; created: number } }>(`/series/${seriesId}/adopt`, {
        projectId,
        applyProfile,
      });
      setProjectId("");
      // It is in the series now: offering it again would only fail.
      void projects.refetch();
      onDone();
      toast.success(`已纳入项目，按名称关联 ${r.synced.linked} 项，从资源库添加 ${r.synced.created} 项`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form aria-label="纳入项目" className="card space-y-2 p-4" onSubmit={(e) => void adopt(e)}>
      <h3 className="font-medium">纳入已有项目</h3>
      <p className="muted text-xs">项目将成为下一集。同名角色、场景和道具会关联到资源库。</p>
      <select
        className="input"
        aria-label="待纳入的项目"
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
      >
        <option value="">选择你的项目…</option>
        {free.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={applyProfile} onChange={(e) => setApplyProfile(e.target.checked)} />
        同时应用系列的频道配置
      </label>
      <button type="submit" className="btn-secondary" disabled={busy || !projectId}>
        纳入
      </button>
    </form>
  );
}

function SplitStory({ seriesId, onDone }: { seriesId: string; onDone: () => void }) {
  const [story, setStory] = useState("");
  const [per, setPer] = useState(3);
  const [preview, setPreview] = useState<{ title: string; chapters: number; characters: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (confirm: boolean) => {
    setBusy(true);
    try {
      const r = await post<{ episodes: { title: string; chapters: number; characters: number }[] }>(
        `/series/${seriesId}/split`,
        { story, perEpisode: per, confirm },
      );
      if (confirm) {
        setStory("");
        setPreview(null);
        onDone();
        toast.success(`已创建 ${r.episodes.length} 集`);
      } else setPreview(r.episodes);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="拆分故事" className="card space-y-2 p-4">
      <h3 className="font-medium">将长篇故事拆分为剧集</h3>
      <textarea
        className="input min-h-24 text-sm"
        aria-label="长篇故事"
        placeholder="粘贴完整故事，将按章节标题拆分。"
        value={story}
        onChange={(e) => {
          setStory(e.target.value);
          setPreview(null);
        }}
      />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="每集章节数">
          <input
            className="input w-24"
            type="number"
            min={1}
            max={50}
            value={per}
            onChange={(e) => {
              setPer(Math.max(1, Number(e.target.value) || 1));
              setPreview(null);
            }}
          />
        </Field>
        <button type="button" className="btn-secondary" disabled={busy || !story.trim()} onClick={() => void go(false)}>
          <Scissors className="size-4" /> 预览
        </button>
        {preview && (
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void go(true)}>
            创建 {preview.length} 集
          </button>
        )}
      </div>
      {preview && (
        <ol className="list-decimal space-y-0.5 pl-5 text-sm">
          {preview.map((p) => (
            <li key={p.title}>
              {p.title}{" "}
              <span className="muted text-xs">
                · {p.chapters ? `${p.chapters} 章 · ` : ""}
                {fmt.num(p.characters)} 个字符
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Appearances({ seriesId, libraryId }: { seriesId: string; libraryId: string }) {
  const cast = useQuery({
    queryKey: ["project", libraryId, "characters"],
    queryFn: () => get<{ characters: { id: string; name: string }[] }>(`/projects/${libraryId}/characters`),
  });
  const [id, setId] = useState("");
  const q = useQuery({
    queryKey: ["series", seriesId, "appearances", id],
    enabled: Boolean(id),
    queryFn: () =>
      get<{
        episodes: {
          projectId: string;
          title: string;
          episodeNumber: number;
          panels: number;
          chapters: { id: string; order: number; title: string; panels: number }[];
        }[];
      }>(`/series/${seriesId}/appearances?kind=character&id=${id}`),
  });
  return (
    <section aria-label="出场记录" className="card space-y-2 p-4">
      <h3 className="flex items-center gap-2 font-medium">
        <Search className="size-4" /> 角色出场位置
      </h3>
      <select className="input" aria-label="资源库角色" value={id} onChange={(e) => setId(e.target.value)}>
        <option value="">选择资源库角色…</option>
        {cast.data?.characters.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {q.isFetching && <Spinner />}
      <ErrorBox error={q.error} />
      {q.data && !q.data.episodes.length && <p className="muted text-sm">尚未在任何剧集中出场。</p>}
      <ul className="space-y-1.5 text-sm">
        {q.data?.episodes.map((e) => (
          <li key={e.projectId}>
            <span className="font-medium">
              {e.episodeNumber}. {e.title}
            </span>{" "}
            <span className="muted">· {e.panels} 个画格</span>
            <ul className="muted ml-4 text-xs">
              {e.chapters.map((ch) => (
                <li key={ch.id}>
                  <Link
                    className="link"
                    to="/projects/$projectId/storyboard"
                    params={{ projectId: e.projectId }}
                    search={{ chapterId: ch.id }}
                  >
                    第 {ch.order} 章 · {ch.title}
                  </Link>{" "}
                  · {ch.panels} 个画格
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The series' reader page: off, unlisted (anyone with the link) or public, at /s/<address>, with an RSS feed. Each
 * chapter appears there from its publish date; a future date shows it as coming.
 */
function ReaderPage({ dashboard, onSaved }: { dashboard: Dashboard; onSaved: () => void }) {
  const s = dashboard.series;
  const [visibility, setVisibility] = useState(s.visibility);
  const [slug, setSlug] = useState(s.publicSlug ?? "");
  const save = useAction(
    () =>
      patch(`/series/${s.id}`, {
        visibility,
        ...(slug.trim() && slug.trim() !== s.publicSlug ? { publicSlug: slug.trim() } : {}),
      }),
    { success: "阅读页已保存", onSuccess: onSaved },
  );
  const share = s.publicSlug ? `${window.location.origin}/s/${s.publicSlug}` : null;
  return (
    <section className="card space-y-3 p-4" aria-label="阅读页">
      <div>
        <h2 className="font-medium">阅读页</h2>
        <p className="muted text-xs">
          读者可在此查看系列封面、简介和已发布章节，逐页或滚动阅读已翻译的语言版本，并通过 RSS 订阅更新。
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="可见性">
          <select
            className="input"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as typeof visibility)}
          >
            <option value="off">关闭</option>
            <option value="unlisted">不公开列出（持有链接即可访问，搜索引擎不收录）</option>
            <option value="public">公开</option>
          </select>
        </Field>
        <Field label="地址（/s/…）" hint="留空则自动生成难以猜测的地址。">
          <input
            className="input w-56"
            value={slug}
            maxLength={60}
            placeholder="my-series"
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
          />
        </Field>
        <button type="button" className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          保存
        </button>
      </div>
      {s.visibility !== "off" && share && (
        <p className="text-sm">
          <a className="underline" href={share} target="_blank" rel="noreferrer">
            {share}
          </a>
          <span className="muted"> · </span>
          <a
            className="underline"
            href={`/api/public/series/${s.publicSlug}/feed.xml`}
            target="_blank"
            rel="noreferrer"
          >
            RSS
          </a>
        </p>
      )}
      <div className="space-y-1">
        <div className="label">发布安排</div>
        {dashboard.episodes.map((e) => (
          <details key={e.id}>
            <summary className="cursor-pointer text-sm">
              第 {e.episodeNumber} 集 · {e.title}
            </summary>
            <EpisodeSchedule projectId={e.id} />
          </details>
        ))}
      </div>
    </section>
  );
}

/** When each chapter of an episode appears on the reader page. */
function EpisodeSchedule({ projectId }: { projectId: string }) {
  const q = useQuery({
    queryKey: ["project", projectId, "chapters"],
    queryFn: () =>
      get<{ chapters: { id: string; order: number; title: string; publishAt: string | null }[] }>(
        `/projects/${projectId}/chapters`,
      ),
  });
  // One at a time, in the order made: leaving an edited date by clicking Unpublish sends the date, then null, and
  // the click must land last.
  const queue = useRef(Promise.resolve());
  const set = (id: string, publishAt: string | null) =>
    (queue.current = queue.current.then(() =>
      patch(`/chapters/${id}`, { publishAt })
        .then(() => q.refetch())
        .then(() => {})
        .catch(toast.error),
    ));
  // datetime-local speaks the reader's local time, without a zone.
  const local = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  };
  return (
    <ul className="mt-1 space-y-1 pl-4 text-sm">
      {q.data?.chapters.map((ch) => (
        <li key={ch.id} className="flex flex-wrap items-center gap-2">
          <span className="mr-auto">
            {ch.order}. {ch.title}
          </span>
          {/* Saved when the field is left, not per change: typing a year digit by digit passes through valid dates in
              the past (0002, 0020…), and each one published the chapter until the last digit landed. */}
          <input
            key={ch.publishAt ?? ""}
            type="datetime-local"
            className="input w-auto py-0.5 text-xs"
            aria-label={`《${ch.title}》的发布时间`}
            defaultValue={local(ch.publishAt)}
            onBlur={(e) => {
              if (e.target.value !== local(ch.publishAt))
                void set(ch.id, e.target.value ? new Date(e.target.value).toISOString() : null);
            }}
          />
          {!ch.publishAt && (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => void set(ch.id, new Date().toISOString())}
            >
              立即发布
            </button>
          )}
          {ch.publishAt && (
            <button type="button" className="btn-ghost text-xs" onClick={() => void set(ch.id, null)}>
              取消发布
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
