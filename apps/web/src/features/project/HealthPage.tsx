import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Accessibility as Accessibility2, AlertTriangle, CheckCircle2, HeartPulse, Info } from "lucide-react";
import { get } from "../../api/client.ts";
import { ErrorBox, fmt, PageHeader, Spinner } from "../../components/ui.tsx";
import { useProjectId } from "./ProjectLayout.tsx";

type Item = {
  key: string;
  label: string;
  count: number;
  severity: "block" | "info";
  link: { to: string; search?: Record<string, string> };
};
type Health = {
  verdict: { ready: boolean; blocking: number };
  items: Item[];
  spend: { usd: number; budgetUsd: number | null };
  disk: { totalBytes: number };
};

const useHealth = (projectId: string) =>
  useQuery({
    queryKey: ["project", projectId, "health"],
    queryFn: () => get<Health>(`/projects/${projectId}/health`),
  });

function Verdict({ h }: { h: Health }) {
  return h.verdict.ready ? (
    <span className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300">
      <CheckCircle2 className="size-4" /> 可发布
    </span>
  ) : (
    <span className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
      <AlertTriangle className="size-4" /> 有 {h.verdict.blocking} 项问题影响发布
    </span>
  );
}

function ItemLink({ projectId, item }: { projectId: string; item: Item }) {
  return (
    <Link
      // The API names in-app routes; they are the project's own pages.
      to={item.link.to as "/projects/$projectId"}
      params={{ projectId }}
      search={item.link.search as never}
      className="text-accent-500 hover:underline"
    >
      {item.label} →
    </Link>
  );
}

/**
 * Everything that stands between the project and publishing, and everything worth knowing, in one place: each item
 * links to where it is fixed. Blocking items are what an export would ship incomplete or wrong.
 */
export function HealthPage() {
  const projectId = useProjectId();
  const q = useHealth(projectId);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const h = q.data;
  const blocking = h.items.filter((i) => i.severity === "block");
  const info = h.items.filter((i) => i.severity === "info");
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <PageHeader title="项目检查" subtitle="查看发布前需要处理的问题和处理入口。" />
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
        <Verdict h={h} />
        <span className="muted">
          已花费 {fmt.usd(h.spend.usd)}
          {h.spend.budgetUsd != null ? ` / 预算 ${fmt.usd(h.spend.budgetUsd)}` : "（未设预算上限）"}
        </span>
        <span className="muted">磁盘占用 {fmt.bytes(h.disk.totalBytes)}</span>
      </div>
      {[
        { title: "发布前需解决", items: blocking, Icon: AlertTriangle, tone: "text-amber-600" },
        { title: "提示", items: info, Icon: Info, tone: "muted" },
      ].map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.title} className="card space-y-2 p-4">
              <h2 className="text-sm font-medium">{g.title}</h2>
              <ul className="space-y-1.5 text-sm">
                {g.items.map((i) => (
                  <li key={i.key} className="flex items-start gap-2">
                    <g.Icon className={`mt-0.5 size-4 shrink-0 ${g.tone}`} />
                    <ItemLink projectId={projectId} item={i} />
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
      {!h.items.length && <p className="muted text-sm">所有内容均已更新。</p>}
      <Accessibility projectId={projectId} />
    </div>
  );
}

type A11y = {
  altText: { panels: number; written: number; empty: string[] };
  readingOrder: { pageId: string; chapter: number; page: number; panels: number; expected: number[] }[];
  lettering: {
    kind: "contrast" | "size";
    pageId: string;
    chapter: number;
    page: number;
    text: string;
    value: number;
    limit: number;
  }[];
};

/**
 * For readers who use a screen reader or read small: alt text, pages whose panel order differs from where the panels
 * sit, and lettering too faint or too small. Each page links to its editor.
 */
function Accessibility({ projectId }: { projectId: string }) {
  const q = useQuery({
    queryKey: ["project", projectId, "accessibility"],
    queryFn: () => get<A11y>(`/projects/${projectId}/accessibility`),
  });
  if (!q.data) return null;
  const a = q.data;
  const pageLink = (x: { pageId: string; chapter: number; page: number }) => (
    <Link
      to="/projects/$projectId/pages/$pageId"
      params={{ projectId, pageId: x.pageId }}
      className="text-accent-500 hover:underline"
    >
      第 {x.chapter} 章 · 第 {x.page} 页
    </Link>
  );
  return (
    <section className="card space-y-3 p-4" aria-label="无障碍">
      <h2 className="flex items-center gap-1.5 text-sm font-medium">
        <Accessibility2 className="size-4" /> 无障碍
      </h2>
      <p className="text-sm">
        替代文本：{a.altText.panels} 个画格中有 {a.altText.written} 个已手动填写。其余根据情节、对白和音效生成描述，供
        EPUB 和阅读器使用。
        {a.altText.empty.length > 0 && (
          <span className="text-amber-600"> 还有 {a.altText.empty.length} 个画格缺少可用于生成描述的内容。</span>
        )}{" "}
        <a className="text-accent-500 hover:underline" href={`/api/projects/${projectId}/transcript?download=1`}>
          旁白文稿
        </a>
      </p>
      {a.readingOrder.length > 0 && (
        <div className="text-sm">
          <h3 className="font-medium">阅读顺序</h3>
          <ul className="space-y-0.5">
            {a.readingOrder.map((r) => (
              <li key={r.pageId}>
                {pageLink(r)}：画格编号与排列不一致。实际阅读顺序为 {r.expected.join(" → ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {a.lettering.length > 0 && (
        <div className="text-sm">
          <h3 className="font-medium">排字</h3>
          <ul className="space-y-0.5">
            {a.lettering.slice(0, 50).map((l, i) => (
              <li key={`${l.pageId}-${i}`}>
                {pageLink(l)}: “{l.text.slice(0, 40)}” —{" "}
                {l.kind === "contrast"
                  ? `对比度为 ${l.value}:1，低于 ${l.limit}:1`
                  : `文字尺寸占页宽的 ${(l.value * 100).toFixed(1)}%，低于 ${(l.limit * 100).toFixed(1)}%`}
              </li>
            ))}
          </ul>
          {a.lettering.length > 50 && <p className="muted text-xs">还有 {a.lettering.length - 50} 项</p>}
        </div>
      )}
      {!a.readingOrder.length && !a.lettering.length && (
        <p className="muted text-sm">阅读顺序、排字对比度和文字尺寸均通过检查。</p>
      )}
    </section>
  );
}

/** The overview's compact version: the verdict and the first few blocking items. */
export function HealthCard({ projectId }: { projectId: string }) {
  const q = useHealth(projectId);
  if (!q.data) return null;
  const h = q.data;
  const blocking = h.items.filter((i) => i.severity === "block");
  return (
    <div className="card space-y-2 p-4 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto flex items-center gap-2 text-sm font-medium">
          <HeartPulse className="size-4" /> 项目检查
        </h3>
        <Link to="/projects/$projectId/health" params={{ projectId }} className="text-accent-500 hover:underline">
          查看详情 →
        </Link>
      </div>
      <div className="text-sm">
        <Verdict h={h} />
      </div>
      {blocking.length > 0 && (
        <ul className="space-y-1">
          {blocking.slice(0, 4).map((i) => (
            <li key={i.key}>
              <ItemLink projectId={projectId} item={i} />
            </li>
          ))}
          {blocking.length > 4 && <li className="muted">还有 {blocking.length - 4} 项</li>}
        </ul>
      )}
    </div>
  );
}
