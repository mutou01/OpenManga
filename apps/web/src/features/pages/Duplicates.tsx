import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { useState } from "react";
import { get, post } from "../../api/client.ts";
import { useAction } from "../../api/hooks.ts";
import { AssetImage, Modal, Spinner, StatusChip } from "../../components/ui.tsx";

type Member = {
  assetId: string;
  panelId?: string;
  pageId?: string;
  chapter?: number;
  chapterTitle?: string;
  page?: number;
  panel?: number;
};
type Scan = {
  id: string;
  status: string;
  failureReason: string | null;
  result: { scannedAt: string; panels: number; groups: { kind: string; score: number; members: Member[] }[] } | null;
};

const KIND: Record<string, string> = {
  identical: "近乎相同的分镜",
  pose: "相距较远的分镜具有相同姿势或场面调度",
  background: "不同场景使用相同背景",
  thumbnail: "近乎相同的封面或缩略图",
};

/** Near-duplicate finder: scan the project without AI and look through the groups it found. */
export function DuplicatesButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const key = ["project", projectId, "duplicates"];
  const q = useQuery({
    queryKey: key,
    queryFn: () => get<{ scan: Scan | null }>(`/projects/${projectId}/duplicates`),
    select: (r) => r.scan,
    enabled: open,
    refetchInterval: (r) =>
      r.state.data?.scan && !["completed", "failed", "cancelled"].includes(r.state.data.scan.status) ? 3000 : false,
  });
  const scan = useAction(() => post(`/projects/${projectId}/duplicates/scan`), {
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
  const s = q.data;
  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        <Copy className="size-4" /> 近似重复
      </button>
      <Modal
        open={open}
        wide
        onClose={() => setOpen(false)}
        title="近似重复"
        footer={
          <button type="button" className="btn-primary" disabled={scan.isPending} onClick={() => scan.mutate()}>
            {s ? "重新扫描" : "扫描项目"}
          </button>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="muted text-xs">
            通过图片特征比较所有已绘制分镜、封面和缩略图，找出可能需要重绘或调整的重复画面，无需调用
            AI。相邻分镜及同一场景中的背景允许一致，不参与此项检查。
          </p>
          {q.isLoading && <Spinner />}
          {s && !s.result && (
            <div className="flex items-center gap-2">
              <StatusChip status={s.status} /> {s.failureReason && <span className="muted">{s.failureReason}</span>}
            </div>
          )}
          {s?.result && (
            <>
              <p className="text-xs">
                {s.result.panels} 个分镜{s.result.panels === 1 ? "" : ""} 已扫描 · {s.result.groups.length} 组
                {s.result.groups.length === 1 ? "" : ""} 已发现
              </p>
              {!s.result.groups.length && <p className="muted">未发现重复。</p>}
              <ul className="space-y-3">
                {s.result.groups.map((g, i) => (
                  <li key={`${g.kind}-${i}`} className="rounded-lg border border-[var(--border)] p-2">
                    <div className="mb-1 text-xs font-medium">
                      {KIND[g.kind] ?? g.kind} <span className="muted">· {Math.round(g.score * 100)}%</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {g.members.map((m) => (
                        <figure key={m.assetId + (m.panelId ?? "")} className="w-28 text-[10px]">
                          <AssetImage assetId={m.assetId} alt="" className="aspect-square w-full rounded" fit="cover" />
                          <figcaption className="mt-0.5 truncate">
                            {m.pageId ? (
                              <Link
                                to="/projects/$projectId/pages/$pageId"
                                params={{ projectId, pageId: m.pageId }}
                                search={{ panelId: m.panelId }}
                                className="underline"
                                title={m.chapterTitle}
                              >
                                章 {m.chapter} 页{m.page}·{m.panel}
                              </Link>
                            ) : (
                              "封面或缩略图"
                            )}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
