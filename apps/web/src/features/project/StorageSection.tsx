import { RETENTION_KINDS, type RetentionKind } from "@openmanga/domain/browser";
import type { ProjectStorage } from "@openmanga/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { get, post, put } from "../../api/client.ts";
import { useAction } from "../../api/hooks.ts";
import { Field, fmt } from "../../components/ui.tsx";

const RETENTION_LABELS: Record<RetentionKind, string> = {
  render_cache: "视频片段缓存",
  export: "导出文件",
  panel_version: "旧版分镜画稿",
  audio_take: "闲置旁白录音",
  trash: "回收站文件",
  prompt_reference: "提示词参考副本",
};

type View = {
  policy: ProjectStorage;
  use: { bytes: number; capBytes: number | null; overCap: boolean };
  expendable: Partial<Record<RetentionKind, { files: number; bytes: number }>>;
  preview: { files: number; bytes: number; afterBytes: number; overLimitBytes: number } | null;
};

/**
 * The project's own storage policy (its owner's): how long each kind of expendable file is kept, and a cap the
 * project stays under. Files a panel shows, approved art, references, uploads and narration in use are never touched.
 */
export function StorageSection({ projectId, owner }: { projectId: string; owner: boolean }) {
  const qc = useQueryClient();
  const key = ["project", projectId, "storage"];
  const q = useQuery({ queryKey: key, queryFn: () => get<View>(`/projects/${projectId}/storage`) });
  if (!q.data) return null;
  return (
    <Form
      key={JSON.stringify(q.data.policy)}
      projectId={projectId}
      owner={owner}
      v={q.data}
      onSaved={(d) => qc.setQueryData(key, d)}
    />
  );
}

function Form({
  projectId,
  owner,
  v,
  onSaved,
}: {
  projectId: string;
  owner: boolean;
  v: View;
  onSaved: (v: View) => void;
}) {
  const [p, setP] = useState<ProjectStorage>(v.policy);
  const save = useAction(() => put<View>(`/projects/${projectId}/storage`, p), {
    success: "存储策略已保存",
    onSuccess: onSaved,
  });
  const apply = useAction(
    () => post<View & { deleted: number; bytes: number }>(`/projects/${projectId}/storage/apply`),
    {
      success: (r) => `已删除 ${r.deleted} 个文件，共 ${fmt.bytes(r.bytes)}`,
      onSuccess: onSaved,
    },
  );
  const days = (x: string) => (x === "" ? null : Math.max(1, Math.round(Number(x))));
  return (
    <section className="card space-y-3 p-4" aria-label="存储">
      <div>
        <h2 className="font-medium">存储</h2>
        <p className="muted text-xs">
          本项目已使用 {fmt.bytes(v.use.bytes)}
          {v.use.capBytes !== null ? `，上限为 ${fmt.bytes(v.use.capBytes)}` : ""}.
          {v.use.overCap && (
            <strong className="text-red-600"> 已超出上限，释放空间后才能继续新的 AI 任务和导出。</strong>
          )}{" "}
          每小时维护时，策略仅清理可重新生成或已闲置的文件。正在使用的分镜画稿、已批准画稿、参考图、上传文件和旁白均会保留。
        </p>
      </div>
      <fieldset disabled={!owner} className="space-y-3" title={owner ? undefined : "只有项目所有者可以设置"}>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={p.enabled} onChange={(e) => setP({ ...p, enabled: e.target.checked })} />
          为此项目启用存储策略
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="删除超过以下天数的可清理文件" hint="留空表示不限保留时间。">
            <input
              className="input"
              type="number"
              min={1}
              value={p.maxAgeDays ?? ""}
              onChange={(e) => setP({ ...p, maxAgeDays: days(e.target.value) })}
            />
          </Field>
          <Field label="存储上限（GB）" hint="优先删除最旧的可清理文件，直到项目用量低于上限。">
            <input
              className="input"
              type="number"
              min={0.1}
              step={0.1}
              value={p.capGb ?? ""}
              onChange={(e) => setP({ ...p, capGb: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </Field>
        </div>
        <KindAges
          value={p.kindAges}
          defaultDays={p.maxAgeDays}
          expendable={v.expendable}
          onChange={(kindAges) => setP({ ...p, kindAges })}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            保存存储策略
          </button>
          {v.preview && v.preview.files > 0 && (
            <>
              <span className="muted text-xs">
                现在应用将删除 {v.preview.files} 个文件，共 {fmt.bytes(v.preview.bytes)}。
              </span>
              <button type="button" className="btn-secondary" disabled={apply.isPending} onClick={() => apply.mutate()}>
                立即应用
              </button>
            </>
          )}
          {v.preview && v.preview.files === 0 && <span className="muted text-xs">当前没有需要删除的文件。</span>}
        </div>
      </fieldset>
    </section>
  );
}

type KindAgesValue = Partial<Record<RetentionKind, number | null>> | undefined;

/** Per kind of expendable file: what is stored now, and whether it keeps the general age, its own, or no age limit. */
export function KindAges({
  value,
  defaultDays,
  expendable,
  onChange,
}: {
  value: KindAgesValue;
  defaultDays: number | null;
  expendable: Partial<Record<RetentionKind, { files: number; bytes: number }>>;
  onChange: (v: KindAgesValue) => void;
}) {
  const age = (k: RetentionKind) => value?.[k];
  return (
    <table className="w-full text-sm">
      <thead className="muted text-left text-xs">
        <tr>
          <th className="py-1 font-medium">类型</th>
          <th className="py-1 font-medium">当前存储</th>
          <th className="py-1 font-medium">保留期限</th>
        </tr>
      </thead>
      <tbody>
        {RETENTION_KINDS.map((k) => (
          <tr key={k} className="border-t border-[var(--border)]">
            <td className="py-1">{RETENTION_LABELS[k]}</td>
            <td className="muted py-1 text-xs">
              {expendable[k] ? `${expendable[k]!.files} · ${fmt.bytes(expendable[k]!.bytes)}` : "—"}
            </td>
            <td className="py-1">
              <select
                className="input w-auto py-0.5 text-xs"
                aria-label={`${RETENTION_LABELS[k]}保留期限`}
                value={age(k) === undefined ? "default" : age(k) === null ? "never" : "days"}
                onChange={(e) => {
                  const rest = { ...value };
                  if (e.target.value === "default") delete rest[k];
                  else rest[k] = e.target.value === "never" ? null : (defaultDays ?? 30);
                  onChange(rest);
                }}
              >
                <option value="default">跟随通用设置</option>
                <option value="days">单独设置天数</option>
                <option value="never">不限保留时间</option>
              </select>
              {typeof age(k) === "number" && (
                <input
                  className="input ml-1 w-20 py-0.5 text-xs"
                  type="number"
                  min={1}
                  aria-label={`${RETENTION_LABELS[k]}保留天数`}
                  value={age(k)!}
                  onChange={(e) => onChange({ ...value, [k]: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
