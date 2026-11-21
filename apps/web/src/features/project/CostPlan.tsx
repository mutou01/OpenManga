import { useQuery } from "@tanstack/react-query";
import { post } from "../../api/client.ts";
import { ErrorBox, fmt, Spinner } from "../../components/ui.tsx";

type Usd = number | null;
type ChapterRow = {
  id: string;
  order: number;
  title: string;
  estimated: boolean;
  panels: number;
  plan: { needed: boolean; usd: Usd };
  prompts: { pages: number; usd: Usd };
  art: { panels: number; usd: Usd; batched: boolean };
  narration: { needed: boolean; usd: Usd };
  audio: { segments: number; seconds: number };
  storageBytes: number;
  usd: Usd;
};
export type CostPlanData = {
  models: { text: { model: string; free?: boolean } | null; image: { model: string } | null };
  project: {
    analysis: { needed: boolean; usd: Usd };
    references: { count: number; estimated: boolean; usd: Usd; batched: boolean };
    thumbnail: { needed: boolean; usd: Usd };
    youtube: { needed: boolean; usd: Usd };
  };
  chapters: ChapterRow[];
  totals: {
    usd: Usd;
    nowUsd: Usd;
    batchedUsd: Usd;
    storageBytes: number;
    panelsToDraw: number;
    estimatedChapters: number;
  };
  budget: { limitUsd: number | null; spentUsd: number; remainingUsd: number | null };
  warnings: string[];
};

const usd = (v: Usd) => (v === null ? "价格未知" : fmt.usd(v));

/**
 * What a production run with these options would still do and cost, before it starts: totals, what runs now and
 * what waits for a half-price batch, the disk it will take, the budget left, and a table per chapter.
 */
export function CostPlan({ projectId, body }: { projectId: string; body: Record<string, unknown> }) {
  const plan = useQuery({
    queryKey: ["cost-plan", projectId, JSON.stringify(body)],
    queryFn: () => post<CostPlanData>(`/projects/${projectId}/production-runs/estimate`, body),
    staleTime: 30_000,
  });
  if (plan.isLoading)
    return (
      <p className="muted flex items-center gap-2 text-xs">
        <Spinner className="size-3" /> 正在估算本次制作费用…
      </p>
    );
  if (plan.error) return <ErrorBox error={plan.error} onRetry={() => plan.refetch()} />;
  const d = plan.data!;
  const t = d.totals;
  const over = t.usd !== null && d.budget.remainingUsd !== null && t.usd > d.budget.remainingUsd;
  return (
    <section aria-label="费用预估" className="space-y-2 rounded-lg border border-[var(--border)] p-3">
      <p className="text-sm">
        约 <strong>{usd(t.usd)}</strong>
        {t.batchedUsd ? (
          <>
            {" "}
            · {usd(t.nowUsd)} 立即执行，{usd(t.batchedUsd)} 半价批处理（结果最多需要一天）
          </>
        ) : null}{" "}
        · 新增文件 {fmt.bytes(t.storageBytes)} · 待绘制 {t.panelsToDraw} 格
      </p>
      <p className={over ? "text-xs text-amber-700 dark:text-amber-300" : "muted text-xs"}>
        预算{" "}
        {d.budget.limitUsd === null
          ? "不设上限"
          : `剩余 ${fmt.usd(d.budget.remainingUsd)}，上限 ${fmt.usd(d.budget.limitUsd)}`}
        {t.estimatedChapters > 0 && ` · 尚有 ${t.estimatedChapters} 章未规划，分镜数和总费用均为估算值`}
        {d.models.text?.free && " · 手动粘贴文本结果，无费用"}
      </p>
      {d.warnings.map((w) => (
        <p key={w} className="text-xs text-amber-700 dark:text-amber-300">
          {w}
        </p>
      ))}
      <details>
        <summary className="cursor-pointer text-xs font-medium">按章节查看</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-xs">
            <thead className="muted text-left">
              <tr>
                <th className="py-1 pr-2">章节</th>
                <th className="py-1 pr-2 text-right">规划</th>
                <th className="py-1 pr-2 text-right">提示词</th>
                <th className="py-1 pr-2 text-right">画稿</th>
                <th className="py-1 pr-2 text-right">旁白</th>
                <th className="py-1 pr-2 text-right">音频</th>
                <th className="py-1 text-right">合计</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["分析", d.project.analysis.needed, d.project.analysis.usd],
                [
                  `参考图（${d.project.references.count}${d.project.references.estimated ? "，估算" : ""}）`,
                  d.project.references.count > 0,
                  d.project.references.usd,
                ],
                ["缩略图", d.project.thumbnail.needed, d.project.thumbnail.usd],
                ["YouTube 文案", d.project.youtube.needed, d.project.youtube.usd],
              ]
                .filter(([, needed]) => needed)
                .map(([label, , v]) => (
                  <tr key={String(label)} className="border-t border-[var(--border)]">
                    <td className="py-1 pr-2" colSpan={6}>
                      {label}
                    </td>
                    <td className="py-1 text-right tabular-nums">{usd(v as Usd)}</td>
                  </tr>
                ))}
              {d.chapters.map((c) => (
                <tr key={c.id} className="border-t border-[var(--border)]">
                  <td className="py-1 pr-2">
                    第 {c.order} 章 {c.title}
                    {c.estimated && <span className="muted"> · 估算</span>}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{c.plan.needed ? usd(c.plan.usd) : "—"}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {c.prompts.pages ? `${c.prompts.pages} 页 · ${usd(c.prompts.usd)}` : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {c.art.panels ? `${c.art.panels} · ${usd(c.art.usd)}${c.art.batched ? "（批处理）" : ""}` : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {c.narration.needed ? usd(c.narration.usd) : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums" title="本地配音，不产生费用">
                    {c.audio.segments ? `${Math.round(c.audio.seconds / 60)} 分钟` : "—"}
                  </td>
                  <td className="py-1 text-right font-medium tabular-nums">{usd(c.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
