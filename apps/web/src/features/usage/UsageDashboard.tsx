import type { UsageSummary } from "../../api/types.ts";
import { fmt } from "../../components/ui.tsx";

const OPERATION_LABELS: Record<string, string> = {
  character_reference: "角色参考图",
  location_reference: "场景参考图",
  prop_reference: "道具参考图",
  style_reference: "风格参考图",
  panel_generation: "画格生成",
  panel_edit: "画格编辑",
  cover: "封面",
  coverage_sheet: "覆盖图",
  duplicate_scan: "重复扫描",
  story_analysis: "故事分析",
  story_rewrite: "故事改写",
  youtube_package: "YouTube 发布包",
  chapter_plan: "章节规划",
  page_prompts: "提示词准备",
  narration_text: "旁白文本",
  narration_lint: "旁白质检",
  narration_fix: "旁白修复",
  audio_check: "音频检查",
  narration_import: "旁白导入",
  story_coverage: "故事覆盖检查",
  narration_retime: "旁白时间调整",
  social_copy: "社交媒体文案",
  expert_chat: "专家对话",
  expert_image: "专家对话图像",
  expert_extract: "专家操作",
  bible_extract: "故事设定集",
  timeline_extract: "故事时间线",
  lettering_translate: "排字翻译",
  video_edit: "文字指令剪辑",
  continuity_check: "连贯性检查",
};

const PROVIDER_COLORS: Record<string, string> = {
  openai: "#3b6cf6",
  deepseek: "#10b981",
  mock: "#f59e0b",
  kokoro: "#8b5cf6",
};
const color = (p: string) => PROVIDER_COLORS[p] ?? "#94a3b8";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="muted text-xs">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="muted text-xs">{hint}</div>}
    </div>
  );
}

function DailyChart({ daily }: { daily: UsageSummary["daily"] }) {
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) days.push(new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10));
  const byDay = new Map<string, { provider: string; cost: number }[]>();
  for (const d of daily) byDay.set(d.day, [...(byDay.get(d.day) ?? []), d]);
  const max = Math.max(0.0001, ...days.map((d) => (byDay.get(d) ?? []).reduce((s, x) => s + x.cost, 0)));
  const providers = [...new Set(daily.map((d) => d.provider))];
  return (
    <div>
      <div className="flex h-40 items-end gap-0.5" role="img" aria-label="最近 30 天每日 API 费用">
        {days.map((day) => {
          const parts = byDay.get(day) ?? [];
          const total = parts.reduce((s, x) => s + x.cost, 0);
          return (
            <div key={day} className="flex h-full flex-1 flex-col justify-end" title={`${day}: ${fmt.usd(total)}`}>
              {parts.map((p) => (
                <div
                  key={p.provider}
                  style={{ height: `${(p.cost / max) * 100}%`, background: color(p.provider) }}
                  className="w-full first:rounded-t-sm"
                />
              ))}
            </div>
          );
        })}
      </div>
      <div className="muted mt-2 flex flex-wrap gap-3 text-xs">
        {providers.map((p) => (
          <span key={p} className="flex items-center gap-1">
            <span className="size-2.5 rounded-sm" style={{ background: color(p) }} /> {PROVIDER_LABELS[p] ?? p}
          </span>
        ))}
        {!providers.length && <span>最近 30 天无支出</span>}
      </div>
    </div>
  );
}

const th = "p-2 text-left font-normal";

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  google: "Google",
  meta: "Meta",
  deepseek: "DeepSeek",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  elevenlabs: "ElevenLabs",
  mock: "模拟供应商",
  kokoro: "Kokoro",
};

export function UsageDashboard({ data }: { data: UsageSummary }) {
  const w = data.windows;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="今天" value={fmt.usd(w.today?.costUsd)} hint={`${w.today?.calls ?? 0} 次调用`} />
        <Stat label="最近 7 天" value={fmt.usd(w["7d"]?.costUsd)} hint={`${w["7d"]?.calls ?? 0} 次调用`} />
        <Stat label="最近 30 天" value={fmt.usd(w["30d"]?.costUsd)} hint={`${w["30d"]?.calls ?? 0} 次调用`} />
        <Stat label="累计" value={fmt.usd(w.lifetime?.costUsd)} hint={`${w.lifetime?.calls ?? 0} 次调用`} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="图像" value={fmt.usd(data.breakdown.imagesUsd)} hint="图像模型" />
        <Stat label="文本" value={fmt.usd(data.breakdown.textUsd)} hint="规划、提示词、旁白" />
        <Stat label="旁白（本地语音合成）" value="$0.00" hint="无外部 API 费用" />
        <Stat
          label="供应商"
          value={String(Object.keys(data.breakdown.byProvider).length)}
          hint={
            Object.keys(data.breakdown.byProvider)
              .map((provider) => PROVIDER_LABELS[provider] ?? provider)
              .join("、") || "暂无"
          }
        />
      </div>
      {Object.keys(data.breakdown.byProvider).length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(data.breakdown.byProvider)
            .sort((a, b) => b[1] - a[1])
            .map(([provider, cost]) => (
              <Stat key={provider} label={PROVIDER_LABELS[provider] ?? provider} value={fmt.usd(cost)} />
            ))}
        </div>
      )}
      {data.breakdown.mockUsd > 0 && <p className="muted text-xs">模拟供应商费用 {fmt.usd(data.breakdown.mockUsd)}</p>}
      {data.unpricedCalls > 0 && (
        <p className="rounded-md bg-amber-500/10 p-2 text-sm text-amber-700 dark:text-amber-300">
          {data.unpricedCalls} 次调用无法计价（该模型缺少费率快照），因此费用统计偏低。管理员可在“管理 →
          费率”中补充费率。
        </p>
      )}

      <section className="card p-4">
        <h2 className="mb-3 font-medium">每日费用（30 天）</h2>
        <DailyChart daily={data.daily} />
      </section>

      <section className="card overflow-x-auto p-4">
        <h2 className="mb-2 font-medium">按操作统计</h2>
        <table className="w-full text-sm">
          <thead className="muted text-xs">
            <tr className="border-b border-[var(--border)]">
              <th className={th}>操作</th>
              <th className={th}>调用次数</th>
              <th className={th}>费用</th>
              <th className={th}>平均耗时</th>
              <th className={th}>失败次数</th>
            </tr>
          </thead>
          <tbody>
            {data.operations.map((o) => (
              <tr key={o.operation} className="border-b border-[var(--border)] last:border-0">
                <td className="p-2">{OPERATION_LABELS[o.operation] ?? o.label}</td>
                <td className="p-2">{fmt.num(o.calls)}</td>
                <td className="p-2">{fmt.usd(o.cost)}</td>
                <td className="p-2">{fmt.ms(o.avg_latency)}</td>
                <td className="p-2">{o.failures}</td>
              </tr>
            ))}
            {!data.operations.length && (
              <tr>
                <td className="muted p-2" colSpan={5}>
                  暂无用量
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card overflow-x-auto p-4">
        <h2 className="mb-2 font-medium">按供应商统计</h2>
        <table className="w-full text-sm">
          <thead className="muted text-xs">
            <tr className="border-b border-[var(--border)]">
              <th className={th}>供应商</th>
              <th className={th}>模型</th>
              <th className={th}>调用次数</th>
              <th className={th}>输入文本</th>
              <th className={th}>输出文本</th>
              <th className={th}>缓存</th>
              <th className={th}>输入图像</th>
              <th className={th}>输出图像</th>
              <th className={th}>费用</th>
            </tr>
          </thead>
          <tbody>
            {data.providers.map((p) => (
              <tr key={`${p.provider}-${p.model}`} className="border-b border-[var(--border)] last:border-0">
                <td className="p-2">{PROVIDER_LABELS[p.provider] ?? p.provider}</td>
                <td className="p-2">{p.model}</td>
                <td className="p-2">{fmt.num(p.calls)}</td>
                <td className="p-2">{fmt.num(p.text_in)}</td>
                <td className="p-2">{fmt.num(p.text_out)}</td>
                <td className="p-2">{fmt.num(p.cached)}</td>
                <td className="p-2">{fmt.num(p.image_in)}</td>
                <td className="p-2">{fmt.num(p.image_out)}</td>
                <td className="p-2">{fmt.usd(p.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card overflow-x-auto p-4">
          <h2 className="font-medium">参考图尺寸对比</h2>
          <p className="muted mb-2 text-xs">
            按提示词参考图的派生图尺寸分组统计画格生成。调整 OPENAI_REFERENCE_MAX_WIDTH/HEIGHT
            前，请对比图像输入词元、费用、耗时和一致性。
          </p>
          <table className="w-full text-sm">
            <thead className="muted text-xs">
              <tr className="border-b border-[var(--border)]">
                <th className={th}>参考图尺寸</th>
                <th className={th}>生成次数</th>
                <th className={th}>平均图像输入</th>
                <th className={th}>平均费用</th>
                <th className={th}>平均耗时</th>
              </tr>
            </thead>
            <tbody>
              {data.referenceExperiments.map((r) => (
                <tr key={r.ref_size} className="border-b border-[var(--border)] last:border-0">
                  <td className="p-2 font-mono">{r.ref_size}</td>
                  <td className="p-2">{r.generations}</td>
                  <td className="p-2">{Math.round(r.avg_image_input_tokens)}</td>
                  <td className="p-2">{fmt.usd(r.avg_cost)}</td>
                  <td className="p-2">{fmt.ms(r.avg_latency)}</td>
                </tr>
              ))}
              {!data.referenceExperiments.length && (
                <tr>
                  <td className="muted p-2" colSpan={5}>
                    尚无使用参考图生成的画格
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <section className="card p-4">
          <h2 className="mb-2 font-medium">质量指标</h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-2xl font-semibold">{data.quality.generatedPanels}</div>
              <div className="muted text-xs">已生成画格</div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{Math.round(data.quality.regenerationRate * 100)}%</div>
              <div className="muted text-xs">重新生成率</div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{Math.round(data.quality.acceptanceRate * 100)}%</div>
              <div className="muted text-xs">采纳率</div>
            </div>
          </div>
          <p className="muted mt-3 text-xs">采纳指已生成画格被标记为已审核或已锁定。</p>
        </section>
      </div>
    </div>
  );
}
