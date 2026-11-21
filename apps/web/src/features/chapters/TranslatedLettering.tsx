import { NARRATION_LANGUAGES } from "@openmanga/domain/browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { get, post, put } from "../../api/client.ts";
import { useAction } from "../../api/hooks.ts";
import { Spinner, StatusChip } from "../../components/ui.tsx";
import { AiChip, useAiBody } from "../ai/AiPicker.tsx";

type Line = {
  sourceType: "dialogue" | "caption";
  sourceId: string;
  pageId: string;
  page: number;
  panel: number | null;
  kind: string;
  speaker: string | null;
  text: string;
  translation: string | null;
  stale: boolean;
  edited: boolean;
};
type Data = {
  language: string;
  sourceLanguage: string;
  lines: Line[];
  translated: number;
  job: { id: string; status: string; failureReason: string | null } | null;
};

/**
 * Chapter → Translated lettering: the chapter's bubbles and captions in another language, re-lettered into the same
 * bubbles for a translated edition. Translate with the text model or by hand; preview a page; export it from Exports.
 */
export function TranslatedLettering({
  chapterId,
  projectLanguage,
  firstPageId,
}: {
  chapterId: string;
  projectLanguage: string;
  firstPageId: string | null;
}) {
  const qc = useQueryClient();
  const others = NARRATION_LANGUAGES.filter((l) => l.code !== projectLanguage);
  const [language, setLanguage] = useState(others[0]?.code ?? "es");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const key = ["chapter", chapterId, "lettering", language];
  const q = useQuery({
    queryKey: key,
    queryFn: () => get<Data>(`/chapters/${chapterId}/lettering?language=${language}`),
    enabled: open,
    refetchInterval: (r) =>
      r.state.data?.job && !["completed", "failed", "cancelled"].includes(r.state.data.job.status) ? 3000 : false,
  });
  const aiText = useAiBody("text");
  const translate = useAction(() => post(`/chapters/${chapterId}/lettering/translate`, { language, ...aiText() }), {
    invalidate: [key],
    success: "正在翻译文字",
  });
  const save = useAction(
    () =>
      put(`/chapters/${chapterId}/lettering`, {
        language,
        lines: Object.entries(draft).map(([sourceId, text]) => ({
          sourceId,
          sourceType: q.data!.lines.find((l) => l.sourceId === sourceId)!.sourceType,
          text,
        })),
      }),
    {
      success: "译文已保存",
      onSuccess: () => {
        setDraft({});
        void qc.invalidateQueries({ queryKey: key });
      },
    },
  );
  const d = q.data;
  const pageForPreview = d?.lines[0]?.pageId ?? firstPageId;
  return (
    <details className="card p-4" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer font-semibold">文字翻译</summary>
      <div className="mt-3 space-y-3 text-sm">
        <p className="muted text-xs">
          将本章气泡和说明文字翻译为其他语言，保留原画面及气泡位置。可在导出中选择文字语言以导出对应版本，视频会采用旁白语言排字。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input w-auto"
            aria-label="版本语言"
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              setDraft({});
            }}
          >
            {others.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
          <AiChip cap="text" />
          <button
            type="button"
            className="btn-secondary"
            disabled={translate.isPending}
            onClick={() => translate.mutate()}
          >
            翻译
          </button>
          {pageForPreview && (
            <a
              className="btn-ghost text-xs"
              href={`/api/pages/${encodeURIComponent(pageForPreview)}/render.png?${new URLSearchParams({ language })}`}
              target="_blank"
              rel="noreferrer"
            >
              预览页面
            </a>
          )}
          {d && (
            <span className="muted ml-auto text-xs">
              已翻译 {d.translated}/{d.lines.length} 条
            </span>
          )}
        </div>
        {d?.job && d.job.status !== "completed" && (
          <div className="flex items-center gap-2 text-xs">
            <StatusChip status={d.job.status} />{" "}
            {d.job.failureReason && <span className="muted">{d.job.failureReason}</span>}
          </div>
        )}
        {q.isLoading && <Spinner />}
        {d && !d.lines.length && <p className="muted">本章暂无气泡或说明文字。</p>}
        {d && d.lines.length > 0 && (
          <div className="max-h-[28rem] overflow-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--panel)]">
                <tr className="text-left">
                  <th className="p-2">位置</th>
                  <th className="p-2">原文</th>
                  <th className="p-2">译文</th>
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.sourceId} className="border-t border-[var(--border)] align-top">
                    <td className="muted whitespace-nowrap p-2">
                      p{l.page}
                      {l.panel ? `·${l.panel}` : ""} {l.kind === "caption" ? "叙述框" : (l.speaker ?? "")}
                    </td>
                    <td className="p-2">{l.text}</td>
                    <td className="p-2">
                      <textarea
                        className="input min-h-8 text-xs"
                        aria-label={`原文：${l.text}`}
                        value={draft[l.sourceId] ?? l.translation ?? ""}
                        onChange={(e) => setDraft((x) => ({ ...x, [l.sourceId]: e.target.value }))}
                      />
                      {l.stale && <span className="text-amber-600">原文已变更</span>}
                      {l.edited && !l.stale && <span className="muted">已手动编辑</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {Object.keys(draft).length > 0 && (
          <button type="button" className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            保存 {Object.keys(draft).length} 项修改
          </button>
        )}
      </div>
    </details>
  );
}
