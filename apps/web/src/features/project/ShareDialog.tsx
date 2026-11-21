import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Trash2 } from "lucide-react";
import { useState } from "react";
import { del, get, patch, post } from "../../api/client.ts";
import { useAction } from "../../api/hooks.ts";
import type { ChapterListItem } from "../../api/types.ts";
import { ErrorBox, Field, fmt, Modal, Spinner } from "../../components/ui.tsx";
import { CopyButton } from "../generation/shared.tsx";

type Share = {
  id: string;
  token: string;
  chapterId: string | null;
  chapterTitle: string | null;
  allowComments: boolean;
  createdAt: string;
};

const readerUrl = (token: string) => `${window.location.origin}/app/read/${token}`;

/** Unlisted, read-only reader links: anyone with one can read, nobody can change anything, and revoking is instant. */
export function ShareDialog({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const key = ["project", projectId, "shares"] as const;
  const shares = useQuery({
    queryKey: key,
    queryFn: () => get<{ shares: Share[] }>(`/projects/${projectId}/shares`),
    enabled: open,
  });
  const chapters = useQuery({
    queryKey: ["project", projectId, "chapters"],
    queryFn: () => get<{ chapters: ChapterListItem[] }>(`/projects/${projectId}/chapters`),
    enabled: open,
  });
  const [chapterId, setChapterId] = useState("");
  const [allowComments, setAllowComments] = useState(false);
  const create = useAction(
    () => post(`/projects/${projectId}/shares`, { chapterId: chapterId || null, allowComments }),
    {
      invalidate: [key],
      success: "已创建链接",
    },
  );
  const revoke = useAction((id: string) => del(`/shares/${id}`), { invalidate: [key], success: "已撤销链接" });
  const toggle = useAction((v: { id: string; allowComments: boolean }) => patch(`/shares/${v.id}`, v), {
    invalidate: [key],
  });
  return (
    <Modal open={open} onClose={onClose} title="分享阅读链接">
      <div className="space-y-4">
        <p className="muted text-sm">
          持有链接的人无需账号即可阅读含排字的页面。开启评论后，访客可填写昵称并评论画格，且只会看到同一链接下的评论。链接不会公开列出，撤销后立即失效。
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="分享范围">
            <select className="input" value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
              <option value="">整个项目</option>
              {chapters.data?.chapters.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  第 {ch.order} 章 · {ch.title}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-1.5 pb-2 text-sm">
            <input type="checkbox" checked={allowComments} onChange={(e) => setAllowComments(e.target.checked)} />
            允许读者评论
          </label>
          <button type="button" className="btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending && <Spinner />} 创建链接
          </button>
        </div>
        <ErrorBox error={shares.error} />
        {shares.data && !shares.data.shares.length && <p className="muted text-sm">暂无分享链接。</p>}
        <ul className="divide-y divide-[var(--border)]">
          {shares.data?.shares.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <div className="mr-auto min-w-0">
                <div className="truncate font-medium">{s.chapterTitle ?? "整个项目"}</div>
                <div className="muted truncate text-xs">
                  {readerUrl(s.token)} · {fmt.ago(s.createdAt)}
                </div>
                <label className="muted mt-0.5 flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={s.allowComments}
                    disabled={toggle.isPending}
                    onChange={(e) => toggle.mutate({ id: s.id, allowComments: e.target.checked })}
                  />
                  访客可填写昵称并评论画格
                </label>
              </div>
              <CopyButton text={readerUrl(s.token)} />
              <a className="btn-secondary" href={readerUrl(s.token)} target="_blank" rel="noreferrer" title="打开">
                <ExternalLink className="size-4" />
              </a>
              <button
                type="button"
                className="btn-secondary"
                title="撤销"
                aria-label="撤销链接"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(s.id)}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
