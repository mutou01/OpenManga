import type { TimelineExtraction } from "@openmanga/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Baby, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { del, get, patch, post } from "../../api/client.ts";
import {
  ConfirmDialog,
  EmptyState,
  ErrorBox,
  Field,
  Modal,
  PageHeader,
  Spinner,
  StatusChip,
  toast,
} from "../../components/ui.tsx";
import { AiChip, useAiBody } from "../ai/AiPicker.tsx";
import { useProjectId } from "../project/ProjectLayout.tsx";

type Event = {
  id: string;
  order: number;
  kind: "event" | "birth";
  title: string;
  description: string;
  when: string;
  day: number | null;
  chapterId: string | null;
  sceneNumber: number | null;
  characterIds: string[];
  since: number | null;
  elapsed: string | null;
  outOfOrder: boolean;
  ages: Record<string, number>;
};
type Data = {
  events: Event[];
  chapters: { id: string; order: number; title: string }[];
  characters: { id: string; name: string }[];
  states: { id: string; characterId: string; kind: string; text: string; eventId: string | null }[];
  extraction: {
    id: string;
    status: string;
    result: { data?: TimelineExtraction; applied?: unknown } | null;
    failureReason: string | null;
  } | null;
};

const key = (projectId: string) => ["project", projectId, "timeline"] as const;
const fmtDay = (d: number) => (Number.isInteger(d) ? String(d) : d.toFixed(2).replace(/0+$/, ""));

/**
 * The story timeline: what happens in story-time order (a flashback where it happened), with elapsed time, ages and
 * the chapter that tells each event. The bible's character states show at the event they start from.
 */
export function TimelinePage() {
  const projectId = useProjectId();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: key(projectId), queryFn: () => get<Data>(`/projects/${projectId}/timeline`) });
  const [edit, setEdit] = useState<Event | "new" | null>(null);
  const [removing, setRemoving] = useState<Event | null>(null);
  const [extracting, setExtracting] = useState(false);
  const d = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: key(projectId) });
  const move = async (i: number, by: -1 | 1) => {
    if (!d) return;
    const ids = d.events.map((e) => e.id);
    [ids[i], ids[i + by]] = [ids[i + by]!, ids[i]!];
    try {
      await post(`/projects/${projectId}/timeline/order`, { ids });
      await refresh();
    } catch (e) {
      toast.error(e);
    }
  };
  const name = (id: string) => d?.characters.find((c) => c.id === id)?.name ?? "?";
  const chapter = (id: string | null) => d?.chapters.find((c) => c.id === id);
  const statesAt = (eventId: string | null) => d?.states.filter((s) => s.eventId === eventId) ?? [];
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <PageHeader
        title="故事时间线"
        subtitle="按故事实际发生时间排列事件，倒叙会放在发生时的位置。故事天数用于计算间隔和年龄，故事设定集状态会显示其起始事件。"
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => setExtracting(true)}>
              <Sparkles className="size-4" /> 从故事提取
            </button>
            <button type="button" className="btn-primary" onClick={() => setEdit("new")}>
              <Plus className="size-4" /> 添加事件
            </button>
          </>
        }
      />
      {q.isLoading && <Spinner />}
      <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      {d && (
        <>
          <Review key={d.extraction?.id} data={d} onDone={refresh} />
          {!d.events.length && <EmptyState title="暂无事件">按发生顺序添加故事事件，或从章节中提取。</EmptyState>}
          {statesAt(null).length > 0 && d.events.length > 0 && (
            <StatesHere label="从开头开始" states={statesAt(null)} name={name} />
          )}
          <ol className="space-y-1" aria-label="时间线">
            {d.events.map((e, i) => {
              const ch = chapter(e.chapterId);
              return (
                <li key={e.id}>
                  {e.outOfOrder ? (
                    <div className="py-1 pl-4 text-xs text-amber-700 dark:text-amber-300">
                      故事天数 {e.day !== null ? fmtDay(e.day) : "?"} 早于上方事件。请调整顺序或修改事件的 天数
                    </div>
                  ) : (
                    e.elapsed &&
                    e.since !== null &&
                    e.since > 0 && <div className="muted py-1 pl-4 text-xs">{e.elapsed}后</div>
                  )}
                  <article className="card flex gap-3 p-3" aria-label={e.title}>
                    <div className="flex flex-col">
                      <button
                        type="button"
                        className="btn-ghost p-1"
                        aria-label={`提前“${e.title}”`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        className="btn-ghost p-1"
                        aria-label={`推后“${e.title}”`}
                        disabled={i === d.events.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown className="size-3.5" />
                      </button>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1 text-sm">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        {e.kind === "birth" && <Baby className="size-3.5 self-center" aria-label="出生" />}
                        <span className="font-medium">{e.title}</span>
                        {e.when && <span className="muted text-xs">{e.when}</span>}
                        {e.day !== null && <span className="muted text-xs">· 故事天数 {fmtDay(e.day)}</span>}
                      </div>
                      {e.description && <p className="muted text-xs">{e.description}</p>}
                      <div className="flex flex-wrap gap-1 text-xs">
                        {ch && (
                          <Link
                            to="/projects/$projectId/chapters/$chapterId"
                            params={{ projectId, chapterId: ch.id }}
                            className="chip hover:underline"
                          >
                            章节 {ch.order}
                            {e.sceneNumber ? `，第 ${e.sceneNumber} 场` : ""}
                          </Link>
                        )}
                        {e.characterIds.map((c) => (
                          <span key={c} className="chip">
                            {name(c)}
                            {e.ages[c] !== undefined && `, ${e.ages[c]}`}
                          </span>
                        ))}
                      </div>
                      {statesAt(e.id).length > 0 && <StatesHere states={statesAt(e.id)} name={name} />}
                    </div>
                    <div className="flex items-start gap-1">
                      <button
                        type="button"
                        className="btn-ghost p-1.5"
                        aria-label={`编辑“${e.title}”`}
                        onClick={() => setEdit(e)}
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="btn-ghost p-1.5 text-red-500"
                        aria-label={`删除“${e.title}”`}
                        onClick={() => setRemoving(e)}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>
          {edit && <EventForm data={d} event={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
          {extracting && <ExtractDialog data={d} onClose={() => setExtracting(false)} />}
          <ConfirmDialog
            open={Boolean(removing)}
            title={`删除“${removing?.title ?? ""}”？`}
            confirmLabel="删除"
            danger
            onClose={() => setRemoving(null)}
            onConfirm={async () => {
              try {
                await del(`/timeline-events/${removing!.id}`);
                await refresh();
              } catch (e) {
                toast.error(e);
              }
              setRemoving(null);
            }}
          >
            此事件将从时间线移除。
          </ConfirmDialog>
        </>
      )}
    </div>
  );
}

function StatesHere({ label, states, name }: { label?: string; states: Data["states"]; name: (id: string) => string }) {
  return (
    <div className="rounded-md bg-[var(--panel-2)] p-2 text-xs">
      {label && <div className="mb-1 font-medium">{label}</div>}
      <ul className="space-y-0.5">
        {states.map((s) => (
          <li key={s.id}>
            <span className="font-medium">{name(s.characterId)}</span> <span className="muted">({s.kind})</span>{" "}
            {s.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EventForm({ data, event, onClose }: { data: Data; event: Event | null; onClose: () => void }) {
  const projectId = useProjectId();
  const qc = useQueryClient();
  const [f, setF] = useState({
    kind: event?.kind ?? ("event" as Event["kind"]),
    title: event?.title ?? "",
    when: event?.when ?? "",
    day: event?.day ?? null,
    description: event?.description ?? "",
    chapterId: event?.chapterId ?? null,
    sceneNumber: event?.sceneNumber ?? null,
    characterIds: event?.characterIds ?? [],
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const b = { ...f, sceneNumber: f.chapterId ? f.sceneNumber : null };
      if (event) await patch(`/timeline-events/${event.id}`, b);
      else await post(`/projects/${projectId}/timeline/events`, b);
      await qc.invalidateQueries({ queryKey: key(projectId) });
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={event ? "编辑事件" : "添加事件"}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn-primary" disabled={busy || !f.title.trim()} onClick={save}>
            {busy && <Spinner />} 保存
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <Field label="事件内容">
          <input
            className="input"
            value={f.title}
            maxLength={200}
            onChange={(e) => setF({ ...f, title: e.target.value })}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="时间" hint="采用故事中的时间表述，例如“1203 年春天”“暴风雨之夜”。">
            <input
              className="input"
              value={f.when}
              maxLength={120}
              onChange={(e) => setF({ ...f, when: e.target.value })}
            />
          </Field>
          <Field label="故事天数" hint="整个故事使用统一天数，数值越大表示越晚，用于计算间隔和年龄。">
            <input
              className="input"
              type="number"
              step="any"
              value={f.day ?? ""}
              onChange={(e) => setF({ ...f, day: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </Field>
          <Field label="类型">
            <select
              className="input"
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value as Event["kind"] })}
            >
              <option value="event">事件</option>
              <option value="birth">出生（用于计算年龄）</option>
            </select>
          </Field>
        </div>
        <Field label="详情">
          <textarea
            className="input min-h-16"
            value={f.description}
            maxLength={1000}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="叙述章节">
            <select
              className="input"
              value={f.chapterId ?? ""}
              onChange={(e) => setF({ ...f, chapterId: e.target.value || null })}
            >
              <option value="">未叙述（仅提及）</option>
              {data.chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  章节 {c.order}: {c.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="场景编号">
            <input
              className="input"
              type="number"
              min={1}
              disabled={!f.chapterId}
              value={f.sceneNumber ?? ""}
              onChange={(e) => setF({ ...f, sceneNumber: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </Field>
        </div>
        <fieldset>
          <legend className="label">参与角色</legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {data.characters.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={f.characterIds.includes(c.id)}
                  onChange={(e) =>
                    setF({
                      ...f,
                      characterIds: e.target.checked
                        ? [...f.characterIds, c.id]
                        : f.characterIds.filter((x) => x !== c.id),
                    })
                  }
                />
                {c.name}
              </label>
            ))}
            {!data.characters.length && <span className="muted text-xs">暂无角色。</span>}
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}

function ExtractDialog({ data, onClose }: { data: Data; onClose: () => void }) {
  const projectId = useProjectId();
  const qc = useQueryClient();
  const aiText = useAiBody("text");
  const [chapterId, setChapterId] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await post(`/projects/${projectId}/timeline/extract`, { ...aiText(), chapterId: chapterId || undefined });
      await qc.invalidateQueries({ queryKey: key(projectId) });
      toast.success("提取任务已加入队列");
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="从故事提取时间线"
      footer={
        <>
          <AiChip cap="text" className="mr-auto" />
          <button type="button" className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn-primary" disabled={busy || !data.chapters.length} onClick={run}>
            {busy && <Spinner />} 提取
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>文本模型会读取章节，按故事时间排列事件，并从原文提取日期、故事天数及出生信息。审核后才会保存。</p>
        {!data.chapters.length && <p className="text-amber-600">暂无章节，请先分析故事并应用分析结果。</p>}
        <Field label="章节">
          <select className="input" value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
            <option value="">所有章节</option>
            {data.chapters.map((c) => (
              <option key={c.id} value={c.id}>
                章节 {c.order}: {c.title}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

/** The latest extraction: running, waiting for a pasted answer, failed, or a proposal to review and apply. */
function Review({ data, onDone }: { data: Data; onDone: () => void }) {
  const projectId = useProjectId();
  const x = data.extraction;
  const proposal = x?.result?.data;
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  if (!x || x.result?.applied) return null;
  if (x.status !== "completed")
    return (
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3 text-sm">
        <span>时间线提取</span>
        <StatusChip status={x.status} />
        {x.status === "failed" && <span className="muted">{x.failureReason}</span>}
        {x.status === "awaiting_input" && (
          <Link className="underline" to="/projects/$projectId/generation/$jobId" params={{ projectId, jobId: x.id }}>
            粘贴回答
          </Link>
        )}
      </div>
    );
  if (!proposal) return null;
  const keep = proposal.events.length - skip.size;
  const apply = async (save: boolean) => {
    setBusy(true);
    try {
      const r = await post<{ events: number; skipped: { entry: string; reason: string }[] }>(
        `/timeline-extractions/${x.id}/apply`,
        { events: save ? proposal.events.filter((_, i) => !skip.has(i)) : [] },
      );
      onDone();
      if (save)
        toast.success(
          `Saved ${r.events} events${r.skipped.length ? `; ${r.skipped.length} names or chapters not found (${r.skipped[0]!.reason})` : ""}`,
        );
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card mb-4 space-y-3 p-3" aria-label="审核提取的时间线">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-medium">审核提取的时间线</h2>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => apply(false)}>
          丢弃
        </button>
        <button type="button" className="btn-primary" disabled={busy || keep === 0} onClick={() => apply(true)}>
          {busy && <Spinner />} 保存 {keep} 个事件
        </button>
      </div>
      <p className="muted text-xs">取消勾选要舍弃的内容，有日期的事件会按故事天数合并。</p>
      <ul className="space-y-1 text-sm">
        {proposal.events.map((e, i) => (
          <li key={i}>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={!skip.has(i)}
                onChange={() => {
                  const next = new Set(skip);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  setSkip(next);
                }}
              />
              <span>
                {e.kind === "birth" && <Baby className="mr-1 inline size-3.5" aria-label="出生" />}
                <strong>{e.title}</strong>{" "}
                <span className="muted text-xs">
                  {[
                    e.when,
                    e.day != null && `day ${fmtDay(e.day)}`,
                    e.chapter && `ch. ${e.chapter}${e.scene ? `, scene ${e.scene}` : ""}`,
                    e.characters.join(", "),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
