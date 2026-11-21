import type { RetentionKind } from "@openmanga/domain/browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HardDrive } from "lucide-react";
import { useEffect, useState } from "react";
import { get, post, put } from "../../api/client.ts";
import { useAction } from "../../api/hooks.ts";
import { ErrorBox, Field, fmt, Spinner } from "../../components/ui.tsx";
import { KindAges } from "../project/StorageSection.tsx";

const RETENTION_LABELS: Record<RetentionKind, string> = {
  render_cache: "视频片段缓存",
  export: "导出文件",
  panel_version: "旧版分镜图片",
  audio_take: "未使用的旁白录音",
  trash: "回收站文件",
  prompt_reference: "提示词参考副本",
};

type Policy = {
  enabled: boolean;
  maxAgeDays: number | null;
  maxTotalGb: number | null;
  mode: "auto" | "approve";
  kindAges?: Partial<Record<RetentionKind, number | null>>;
};
type Summary = {
  computedAt: string;
  files: number;
  bytes: number;
  totalBytes: number;
  afterBytes: number;
  overLimitBytes: number;
  reasons: { age: number; size: number };
  byKind: Partial<Record<RetentionKind, { files: number; bytes: number }>>;
};
type StorageView = {
  policy: Policy;
  usage: { totalBytes: number; expendable: Partial<Record<RetentionKind, { files: number; bytes: number }>> };
  preview: Summary | null;
  pending: Summary | null;
  disk: { totalBytes: number; freeBytes: number } | null;
};
export const storageKeys = { view: ["admin", "storage"] as const, alert: ["admin", "storage", "alert"] as const };

/** What a summary deletes, kind by kind. */
export function SummaryList({ s }: { s: Summary }) {
  return (
    <ul className="list-inside list-disc text-xs">
      {Object.entries(s.byKind).map(([k, v]) => (
        <li key={k}>
          {RETENTION_LABELS[k as RetentionKind]}，{v!.files} 个文件， {fmt.bytes(v!.bytes)}
        </li>
      ))}
    </ul>
  );
}

/**
 * The server's storage policy: a maximum age and a maximum total size for the files the app can do without, applied by
 * the hourly maintenance pass, either at once or after an administrator approves.
 */
export function StorageTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: storageKeys.view, queryFn: () => get<StorageView>("/admin/storage") });
  const [p, setP] = useState<Policy | null>(() => q.data?.policy ?? null);
  useEffect(() => {
    if (q.data && !p) setP(q.data.policy);
  }, [q.data, p]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: storageKeys.view });
    void qc.invalidateQueries({ queryKey: storageKeys.alert });
  };
  const save = useAction((v: Policy) => put<StorageView>("/admin/storage/policy", v), {
    success: "存储策略已保存",
    onSuccess: (v) => {
      qc.setQueryData(storageKeys.view, v);
      setP(v.policy);
      void qc.invalidateQueries({ queryKey: storageKeys.alert });
    },
  });
  const approve = useAction(() => post("/admin/storage/approve"), {
    success: "正在删除，完成后告警会消失",
    onSuccess: () => setTimeout(refresh, 3000),
  });
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data || !p) return <Spinner />;
  const d = q.data;
  const expendable = Object.values(d.usage.expendable).reduce((n, v) => n + (v?.bytes ?? 0), 0);
  const number = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card space-y-3 p-4">
        <h2 className="flex items-center gap-2 font-medium">
          <HardDrive className="size-4" /> 存储策略
        </h2>
        <p className="muted text-xs">
          超过保留期限的可清理文件会被删除；若总存储量仍超限，将继续从最旧的可清理文件开始删除，直到低于上限。正在使用的分镜图片、已批准或锁定的图片、参考图、封面、缩略图、上传文件及正在使用的旁白音频均会保留。
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={p.enabled} onChange={(e) => setP({ ...p, enabled: e.target.checked })} />
          启用存储策略
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="删除超过保留期限的文件（天）" hint="留空表示不限保留时间">
            <input
              className="input"
              type="number"
              min={1}
              value={p.maxAgeDays ?? ""}
              onChange={(e) => setP({ ...p, maxAgeDays: number(e.target.value) })}
            />
          </Field>
          <Field label="总存储上限（GB）" hint="留空表示不限大小">
            <input
              className="input"
              type="number"
              min={1}
              value={p.maxTotalGb ?? ""}
              onChange={(e) => setP({ ...p, maxTotalGb: number(e.target.value) })}
            />
          </Field>
        </div>
        <KindAges
          value={p.kindAges}
          defaultDays={p.maxAgeDays}
          expendable={d.usage.expendable}
          onChange={(kindAges) => setP({ ...p, kindAges })}
        />
        <fieldset className="space-y-1 text-sm">
          <legend className="label">文件满足清理条件时</legend>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="storage-mode"
              checked={p.mode === "approve"}
              onChange={() => setP({ ...p, mode: "approve" })}
            />
            <span>
              先询问我
              <span className="muted block text-xs">管理员会在各页面顶部看到告警，直到批准清理或更改策略。</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="storage-mode"
              checked={p.mode === "auto"}
              onChange={() => setP({ ...p, mode: "auto" })}
            />
            <span>
              自动删除
              <span className="muted block text-xs">在每小时的维护任务中执行，并记录到审计日志。</span>
            </span>
          </label>
        </fieldset>
        <button type="button" className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(p)}>
          保存策略
        </button>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-medium">使用情况</h2>
        <p className="text-sm">
          已存储 {fmt.bytes(d.usage.totalBytes)}，其中可清理 {fmt.bytes(expendable)}
          {d.disk && ` · 磁盘可用 ${fmt.bytes(d.disk.freeBytes)}，总计 ${fmt.bytes(d.disk.totalBytes)}`}
        </p>
        <ul className="space-y-0.5 text-xs">
          {Object.entries(RETENTION_LABELS).map(([k, label]) => {
            const v = d.usage.expendable[k as RetentionKind];
            return (
              <li key={k} className="flex justify-between gap-2">
                <span>{label}</span>
                <span className="muted tabular-nums">{v ? `${v.files} · ${fmt.bytes(v.bytes)}` : "无"}</span>
              </li>
            );
          })}
        </ul>
        {d.pending?.files ? (
          <div className="space-y-2 rounded-lg bg-amber-500/10 p-3 text-sm">
            <p>
              等待你审批{" "}
              <strong>
                {d.pending.files} 个文件， {fmt.bytes(d.pending.bytes)}
              </strong>{" "}
              （{d.pending.reasons.age} 个超过保留期限，{d.pending.reasons.size} 个用于释放超限空间）。
            </p>
            <SummaryList s={d.pending} />
            <button type="button" className="btn-danger" disabled={approve.isPending} onClick={() => approve.mutate()}>
              立即删除 {d.pending.files} 个文件
            </button>
          </div>
        ) : d.preview ? (
          <div className="space-y-1 text-sm">
            <p>
              当前策略预计删除 {d.preview.files} 个文件，共 {fmt.bytes(d.preview.bytes)}，清理后剩余{" "}
              {fmt.bytes(d.preview.afterBytes)}。
            </p>
            <SummaryList s={d.preview} />
          </div>
        ) : (
          <p className="muted text-sm">暂无生效策略，不会删除文件。</p>
        )}
        {(d.pending?.overLimitBytes ?? 0) > 0 && (
          <p className="text-sm text-red-600 dark:text-red-400">
            清理全部可清理文件后，仍超出上限 {fmt.bytes(d.pending!.overLimitBytes)}
            ，剩余文件正在使用中。请提高上限或删除不再需要的项目。
          </p>
        )}
      </section>
    </div>
  );
}
