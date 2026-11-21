import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { get } from "../../api/client.ts";
import type { ChapterListItem } from "../../api/types.ts";
import { EmptyState, ErrorBox, Field, fmt, PageHeader, Spinner, Tabs } from "../../components/ui.tsx";
import { useProjectId } from "../project/ProjectLayout.tsx";
import { type Comment, CommentText, commentKeys, Source } from "./comments.tsx";

type Status = "open" | "resolved" | "all";
type Row = Comment & {
  pageId: string;
  pageOrder: number;
  panelOrder: number;
  chapterId: string;
  chapterOrder: number;
  chapterTitle: string;
  replies: number;
  lastActivityAt: string;
};

/** Every comment thread in the project (or one chapter), open ones first: the review queue for a shared project. */
export function CommentsPage() {
  const projectId = useProjectId();
  const [status, setStatus] = useState<Status>("open");
  const [chapterId, setChapterId] = useState("");
  const [mine, setMine] = useState(false);
  const chapters = useQuery({
    queryKey: ["project", projectId, "chapters"],
    queryFn: () => get<{ chapters: ChapterListItem[] }>(`/projects/${projectId}/chapters`),
  });
  const q = useQuery({
    queryKey: [...commentKeys.project(projectId), status, chapterId, mine],
    queryFn: () =>
      get<{ threads: Row[] }>(
        `/projects/${projectId}/comments?status=${status}${chapterId ? `&chapterId=${chapterId}` : ""}${mine ? "&assignee=me" : ""}`,
      ),
  });
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <PageHeader title="评论" subtitle="项目成员对画格的评论。" />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Tabs
          value={status}
          onChange={setStatus}
          tabs={[
            { value: "open", label: "待处理" },
            { value: "resolved", label: "已解决" },
            { value: "all", label: "全部" },
          ]}
        />
        <Field label="章节">
          <select className="input" value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
            <option value="">所有章节</option>
            {chapters.data?.chapters.map((ch) => (
              <option key={ch.id} value={ch.id}>
                第 {ch.order} 章 · {ch.title}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-1.5 pb-2 text-sm">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          分配给我
        </label>
      </div>
      {q.isLoading && <Spinner />}
      <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      {q.data && !q.data.threads.length && (
        <EmptyState title={status === "open" ? "暂无待处理评论" : "暂无评论"}>
          在页面编辑器的“评论”页签中评论画格。
        </EmptyState>
      )}
      <ul className="space-y-2">
        {q.data?.threads.map((t) => (
          <li key={t.id}>
            <Link
              to="/projects/$projectId/pages/$pageId"
              params={{ projectId, pageId: t.pageId }}
              search={{ panelId: t.panelId, tab: "comments" }}
              className="card block space-y-1 p-3 hover:border-accent-500"
            >
              <div className="muted flex flex-wrap gap-x-2 text-xs">
                <span>
                  第 {t.chapterOrder} 章 · 第 {t.pageOrder} 页 · 第 {t.panelOrder} 格
                </span>
                <span className="inline-flex flex-wrap items-center gap-1">
                  {t.guestName ? `${t.guestName}（访客）` : t.authorName || t.author || "已退出的成员"}{" "}
                  {!t.guestName && <Source viaAgent={t.viaAgent} agentName={t.agentName} />} ·{" "}
                  {fmt.ago(t.lastActivityAt)}
                </span>
                {t.replies > 0 && <span>{t.replies} 条回复</span>}
                {t.resolvedAt && <span>已解决{t.resolvedViaAgent ? " · 通过 MCP" : ""}</span>}
                {t.assignee && <span>分配给 @{t.assignee}</span>}
                {t.anchor && <span>已标记位置</span>}
                {t.timecodeMs !== null && (
                  <span>
                    视频时间 {Math.floor(t.timecodeMs / 60_000)}:
                    {String(Math.floor(t.timecodeMs / 1000) % 60).padStart(2, "0")}
                  </span>
                )}
              </div>
              {t.deletedAt ? <p className="muted text-sm italic">评论已删除</p> : <CommentText body={t.body} />}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
