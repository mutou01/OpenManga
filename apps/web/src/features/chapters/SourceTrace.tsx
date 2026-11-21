import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { get, post } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import { clsx, Spinner } from "../../components/ui.tsx";

type Trace = {
  text: string;
  revision: { number: number; offset: number | null } | null;
  panels: {
    panelId: string;
    pageId: string;
    sceneId: string | null;
    page: number;
    panel: number;
    start: number | null;
    end: number | null;
    changed: boolean;
    was: string | null;
  }[];
  scenes: { sceneId: string; title: string; start: number | null; end: number | null; changed: boolean }[];
  narration: { lineId: string; panelId: string | null; text: string }[];
  changed: number;
};

/**
 * Chapter → Story source: the chapter's text with each panel's part marked (hover for the panel, its scene and its
 * narration; click the marker to open the panel). Panels whose text was revised after planning are listed first.
 */
export function SourceTrace({ projectId, chapterId }: { projectId: string; chapterId: string }) {
  const [open, setOpen] = useState(() => typeof location !== "undefined" && location.hash === "#source");
  const qc = useQueryClient();
  const key = [...qk.chapter(chapterId), "source"];
  const q = useQuery({ queryKey: key, queryFn: () => get<Trace>(`/chapters/${chapterId}/source`), enabled: open });
  const retrace = useAction(() => post(`/chapters/${chapterId}/source/trace`), {
    success: "画格已追溯到当前原文",
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
  const [hover, setHover] = useState<string | null>(null);
  const t = q.data;
  const label = (p: Trace["panels"][number]) => `${p.page}.${p.panel}`;

  // The text cut at every span edge; each piece lists the panels that tell it.
  const pieces: { start: number; end: number; panels: Trace["panels"] }[] = [];
  if (t) {
    const live = t.panels.filter((p) => p.start !== null && !p.changed);
    const cuts = [...new Set([0, t.text.length, ...live.flatMap((p) => [p.start!, p.end!])])].sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const [s, e] = [cuts[i]!, cuts[i + 1]!];
      pieces.push({ start: s, end: e, panels: live.filter((p) => p.start! <= s && p.end! >= e) });
    }
  }
  const sceneOf = (id: string | null) => t?.scenes.find((s) => s.sceneId === id)?.title;
  const narrationOf = (id: string) => t?.narration.filter((n) => n.panelId === id).map((n) => n.text) ?? [];

  return (
    <details
      id="source"
      className="card p-4"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer font-semibold">故事原文</summary>
      <p className="muted mt-1 text-xs">
        根据画格的节拍和对白追溯其对应的章节原文。悬停原文可查看画格、场景及旁白，点击标记可打开画格。
      </p>
      {q.isLoading && <Spinner />}
      {t && !t.text && <p className="muted mt-2 text-sm">本章暂无原文。</p>}
      {t?.text && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {t.revision && (
              <span className="muted">
                故事修订版 {t.revision.number}
                {t.revision.offset === null ? "（本章原文与该修订版并非逐字对应）" : ""}
              </span>
            )}
            <button
              type="button"
              className="btn-secondary ml-auto text-xs"
              disabled={retrace.isPending}
              onClick={() => retrace.mutate()}
            >
              重新追溯
            </button>
          </div>
          {t.changed > 0 && (
            <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-xs">
              <div className="mb-1 font-medium">规划后原文已修改，涉及 {t.changed} 个画格</div>
              <ul className="space-y-1">
                {t.panels
                  .filter((p) => p.changed)
                  .map((p) => (
                    <li key={p.panelId}>
                      <Link
                        to="/projects/$projectId/pages/$pageId"
                        params={{ projectId, pageId: p.pageId }}
                        search={{ panelId: p.panelId }}
                        className="font-medium underline"
                      >
                        第 {p.page} 页，第 {p.panel} 格
                      </Link>
                      <span className="muted"> 规划依据为“{p.was}”</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          <div className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border)] p-3 text-sm leading-relaxed">
            {pieces.map((pc) => {
              const first = pc.panels[0];
              const starts = pc.panels.filter((p) => p.start === pc.start);
              const lit = hover !== null && pc.panels.some((p) => p.panelId === hover);
              return (
                <span
                  key={pc.start}
                  title={pc.panels
                    .map((p) =>
                      [
                        `第 ${p.page} 页，第 ${p.panel} 格`,
                        sceneOf(p.sceneId) && `场景：${sceneOf(p.sceneId)}`,
                        ...narrationOf(p.panelId).map((n) => `旁白：${n}`),
                      ]
                        .filter(Boolean)
                        .join("\n"),
                    )
                    .join("\n\n")}
                  onMouseEnter={() => setHover(first?.panelId ?? null)}
                  onMouseLeave={() => setHover(null)}
                  className={clsx(
                    first && (t.panels.indexOf(first) % 2 ? "bg-sky-500/10" : "bg-violet-500/10"),
                    lit && "bg-accent-500/25",
                  )}
                >
                  {starts.map((p) => (
                    <Link
                      key={p.panelId}
                      to="/projects/$projectId/pages/$pageId"
                      params={{ projectId, pageId: p.pageId }}
                      search={{ panelId: p.panelId }}
                      aria-label={`打开第 ${p.page} 页第 ${p.panel} 格`}
                      className="mr-1 rounded bg-[var(--panel-2)] px-1 align-super text-[10px] font-medium no-underline"
                    >
                      {label(p)}
                    </Link>
                  ))}
                  {t.text.slice(pc.start, pc.end)}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </details>
  );
}
