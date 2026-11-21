import type { ChannelProfile, ProjectSettings } from "@openmanga/schemas";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { get, post } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import { ErrorBox, Field, fmt, Modal, Spinner } from "../../components/ui.tsx";

export const useProfiles = () =>
  useQuery({
    queryKey: ["channel-profiles"],
    queryFn: () => get<{ profiles: ChannelProfile[] }>("/channel-profiles"),
  });

type Change = { key: string; from: unknown; to: unknown };
const LABELS: Record<string, string> = {
  imageQuality: "图像质量",
  referencePolicy: "生成参考图的范围",
  batchPolicy: "制作费用策略",
  targetRuntime: "目标时长",
  narrationVoice: "旁白音色",
  narrationSpeed: "旁白语速",
  pronunciation: "发音词典",
  lettering: "排字和卡片字体",
  thumbnailStyle: "缩略图样式",
  youtubeRules: "YouTube 规则",
  "video.fadeAtSceneBreaks": "场景切换淡化",
  "video.watermark": "标志水印",
  "video.intro": "片头卡片",
  "video.outro": "片尾卡片",
  "video.output": "导出画幅与分辨率",
};
const show = (v: unknown) =>
  v === null || v === undefined ? "无" : typeof v === "object" ? JSON.stringify(v) : String(v);

/**
 * Where the project's settings came from, and re-applying a profile: what would change is listed first, and nothing
 * is copied until it is confirmed. A profile is not linked live, so later edits to it reach a project only this way.
 */
export function ProfileCard({ projectId, from }: { projectId: string; from: ProjectSettings["channelProfile"] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card space-y-2 p-4">
      <h3 className="text-sm font-medium">频道配置</h3>
      <p className="muted text-xs">
        {from ? (
          <>
            频道配置 <strong className="text-[var(--text)]">{from.name}</strong> · {fmt.ago(from.appliedAt)}应用
          </>
        ) : (
          "此项目未使用频道配置。"
        )}
      </p>
      <button type="button" className="btn-secondary w-full justify-center" onClick={() => setOpen(true)}>
        {from ? "重新应用频道配置" : "应用频道配置"}
      </button>
      {open && <ApplyDialog projectId={projectId} fromId={from?.id ?? null} onClose={() => setOpen(false)} />}
    </div>
  );
}

function ApplyDialog({
  projectId,
  fromId,
  onClose,
}: {
  projectId: string;
  fromId: string | null;
  onClose: () => void;
}) {
  const profiles = useProfiles();
  const list = profiles.data?.profiles ?? [];
  const [chosen, setChosen] = useState<string>();
  const profileId = chosen ?? (list.some((p) => p.id === fromId) ? fromId : list[0]?.id) ?? "";
  const diff = useQuery({
    queryKey: ["project", projectId, "profile-diff", profileId],
    queryFn: () => post<{ changes: Change[] }>(`/projects/${projectId}/apply-profile`, { profileId }),
    enabled: Boolean(profileId),
    gcTime: 0,
  });
  const apply = useAction(() => post(`/projects/${projectId}/apply-profile`, { profileId, confirm: true }), {
    invalidate: [qk.project(projectId)],
    success: "已应用频道配置",
    onSuccess: onClose,
  });
  const changes = diff.data?.changes ?? [];
  return (
    <Modal
      open
      onClose={onClose}
      title="应用频道配置"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!changes.length || apply.isPending}
            onClick={() => apply.mutate()}
          >
            {apply.isPending && <Spinner />} 应用{changes.length > 0 ? ` ${changes.length} 项` : ""}更改
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {profiles.isLoading && <Spinner />}
        {profiles.data && !list.length && (
          <p className="text-sm">
            还没有频道配置。
            <Link to="/profiles" className="text-accent-500 hover:underline">
              新建频道配置
            </Link>
            。
          </p>
        )}
        {fromId && profiles.data && !list.some((p) => p.id === fromId) && (
          <p className="muted text-xs">你无法访问项目原来的频道配置。该配置可能已删除，或项目来自其他用户。</p>
        )}
        {list.length > 0 && (
          <Field label="频道配置">
            <select className="input" value={profileId} onChange={(e) => setChosen(e.target.value)}>
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <ErrorBox error={diff.error} />
        {diff.isFetching && <Spinner />}
        {diff.data &&
          (changes.length ? (
            <ul className="divide-y divide-[var(--border)] text-sm">
              {changes.map((c) => (
                <li key={c.key} className="py-2">
                  <div className="font-medium">{LABELS[c.key] ?? c.key}</div>
                  <div className="text-xs break-all">
                    <span className="muted line-through">{show(c.from)}</span> → {show(c.to)}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted text-sm">项目设置已与频道配置一致。</p>
          ))}
        <p className="muted text-xs">
          应用后将复制频道设置，保留项目形式、类型和画风。后续修改频道配置时，可再次应用来更新项目。
        </p>
      </div>
    </Modal>
  );
}
