import type { CharacterBible, ImageDescription } from "@openmanga/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, GitBranch, Info, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useCallback, useState } from "react";
import { ApiError, del, get, patch, post } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import type { CharacterDetail, CharacterVersionRow, ContentWarning } from "../../api/types.ts";
import {
  ConfirmDialog,
  ErrorBox,
  Modal,
  PageHeader,
  SaveIndicator,
  Spinner,
  StatusChip,
  toast,
  useAutosave,
} from "../../components/ui.tsx";
import { useProjectId } from "../project/ProjectLayout.tsx";
import { DescribeImageButton } from "../vision/DescribeImageButton.tsx";
import { FieldGroup, ListRow, TextRow, VERSION_ACTIONS } from "./fields.tsx";
import { OutfitsEditor } from "./OutfitsEditor.tsx";
import { ReferencePanel } from "./ReferencePanel.tsx";

const ROLES = ["protagonist", "antagonist", "supporting", "minor"];

export function CharacterDetailPage() {
  const projectId = useProjectId();
  const { characterId } = useParams({ strict: false }) as { characterId: string };
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = qk.character(characterId);
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: key,
    queryFn: () => get<CharacterDetail>(`/characters/${characterId}`),
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [alias, setAlias] = useState("");
  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: qk.character(characterId) });
    qc.invalidateQueries({ queryKey: qk.cast(projectId) });
  }, [qc, characterId, projectId]);
  const inv = { invalidate: [key, qk.cast(projectId)] };

  const rename = useAction(
    (body: { name?: string; role?: string; currentVersionId?: string }) => patch(`/characters/${characterId}`, body),
    inv,
  );
  const restore = useAction(() => post(`/characters/${characterId}/restore`), {
    ...inv,
    success: "角色已恢复",
  });
  const trash = useAction(() => del(`/characters/${characterId}`), {
    ...inv,
    success: "角色已移入回收站",
    onSuccess: () => navigate({ to: "/projects/$projectId/cast", params: { projectId } }),
  });
  const setStatus = useAction(
    ({ id, status }: { id: string; status: string }) => post(`/character-versions/${id}/status`, { status }),
    inv,
  );
  const newVersion = useAction(
    (fromVersionId: string) =>
      post<{ version: CharacterVersionRow }>(`/characters/${characterId}/versions`, {
        fromVersionId,
        changeNote: "新建外观版本",
      }),
    { ...inv, success: (r) => `Created v${r.version.versionNumber}`, onSuccess: (r) => setSelected(r.version.id) },
  );
  const addAlias = useAction(() => post(`/characters/${characterId}/aliases`, { alias: alias.trim() }), {
    ...inv,
    onSuccess: () => setAlias(""),
  });
  const removeAlias = useAction((id: string) => del(`/character-aliases/${id}`), inv);

  if (isLoading)
    return (
      <div className="p-6">
        <Spinner className="size-6" />
      </div>
    );
  if (error || !data)
    return (
      <div className="p-6">
        <ErrorBox error={error} onRetry={() => refetch()} />
      </div>
    );
  const { character: ch, versions } = data;
  const version = versions.find((v) => v.id === (selected ?? ch.currentVersionId)) ?? versions[0];

  return (
    <div className="space-y-5 p-6">
      <Link to="/projects/$projectId/cast" params={{ projectId }} className="muted text-xs hover:underline">
        ← 角色
      </Link>
      {ch.deletedAt && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-amber-500/10 p-3 text-sm">
          <span className="mr-auto">此角色及其参考图已移入回收站，恢复角色会一并恢复参考图。</span>
          <button type="button" className="btn-secondary" disabled={restore.isPending} onClick={() => restore.mutate()}>
            <RotateCcw className="size-4" /> 恢复
          </button>
        </div>
      )}
      <PageHeader
        title={
          <input
            className="w-full bg-transparent text-xl font-semibold outline-none focus:underline"
            defaultValue={ch.name}
            key={ch.name}
            aria-label="角色名称"
            onBlur={(e) =>
              e.target.value.trim() && e.target.value !== ch.name && rename.mutate({ name: e.target.value.trim() })
            }
          />
        }
        actions={
          <>
            <select
              className="input w-auto"
              value={ch.role}
              onChange={(e) => rename.mutate({ role: e.target.value })}
              aria-label="角色类型"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setMigrateOpen(true)}
              disabled={versions.length < 2}
            >
              <GitBranch className="size-4" /> 迁移画格
            </button>
            <button
              type="button"
              className="btn-ghost text-red-500"
              onClick={() => setTrashOpen(true)}
              aria-label="将角色移入回收站"
            >
              <Trash2 className="size-4" />
            </button>
          </>
        }
      />
      <div className="flex items-start gap-2 rounded-lg border border-accent-500/30 bg-accent-500/10 p-3 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-accent-500" />
        <div>
          每个版本以已审核的标准参考图为身份依据，历史画格用于保持连贯性。修改外观会创建新版本，现有画格在迁移后才会采用新版本。
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[18rem_1fr]">
        <aside className="space-y-4">
          <section className="card p-3">
            <h2 className="mb-2 text-sm font-semibold">版本</h2>
            <ul className="space-y-1">
              {versions.map((v) => (
                <li key={v.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setSelected(v.id)}
                    className={`w-full rounded-lg p-2 text-left text-sm ${v.id === version?.id ? "bg-accent-600/15" : "hover:bg-[var(--panel-2)]"}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">v{v.versionNumber}</span>
                      <StatusChip status={v.status} />
                      {v.id === ch.currentVersionId && (
                        <span className="chip bg-accent-500/15 text-accent-500">当前</span>
                      )}
                    </div>
                    <div className="muted mt-0.5 text-xs">
                      {v.panelCount} 个画格 · {v.changeNote || "—"}
                    </div>
                  </button>
                  {v.status === "draft" && versions.length > 1 && v.panelCount === 0 && (
                    <button
                      type="button"
                      aria-label={`删除草稿第 ${v.versionNumber} 版`}
                      title="删除此草稿版本"
                      className="btn-ghost absolute top-1 right-1 p-1 text-red-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!window.confirm(`删除草稿 v${v.versionNumber}？`)) return;
                        try {
                          await del(`/character-versions/${v.id}`);
                          if (selected === v.id) setSelected(null);
                          await refresh();
                          toast.success(`已删除 v${v.versionNumber}`);
                        } catch (err) {
                          toast.error(err);
                        }
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section className="card p-3">
            <h2 className="mb-2 text-sm font-semibold">别名</h2>
            <div className="mb-2 flex flex-wrap gap-1">
              {data.aliases.map((a) => (
                <span key={a.id} className="chip bg-[var(--panel-2)]">
                  {a.alias}
                  <button type="button" onClick={() => removeAlias.mutate(a.id)} aria-label={`移除别名“${a.alias}”`}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              {!data.aliases.length && <span className="muted text-xs">无</span>}
            </div>
            <form
              className="flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (alias.trim()) addAlias.mutate();
              }}
            >
              <input
                className="input"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="男孩"
                aria-label="新别名"
              />
              <button type="submit" className="btn-secondary" aria-label="添加别名">
                <Plus className="size-4" />
              </button>
            </form>
          </section>
          <OutfitsEditor
            references={data.references}
            characterId={characterId}
            versionId={version?.id ?? null}
            outfits={data.outfits}
            onChanged={refresh}
          />
        </aside>

        {version && (
          <div className="min-w-0 space-y-5">
            <section className="card p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="mr-auto font-semibold">外观版本 v{version.versionNumber}</h2>
                {version.id !== ch.currentVersionId && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => rename.mutate({ currentVersionId: version.id })}
                  >
                    设为当前
                  </button>
                )}
                {VERSION_ACTIONS[version.status]?.map((a) => (
                  <button
                    key={a.status}
                    type="button"
                    className={a.status === "approved" ? "btn-primary" : "btn-secondary"}
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ id: version.id, status: a.status })}
                  >
                    {a.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => newVersion.mutate(version.id)}
                  disabled={newVersion.isPending}
                >
                  <GitBranch className="size-4" /> 新建外观版本
                </button>
              </div>
              {version.status !== "draft" && (
                <p className="muted mb-3 text-sm">
                  此版本为 <b>{version.status}</b> ，已设为只读以保证历史画格可复现。需要修改时请新建外观版本。
                </p>
              )}
              <ContentWarnings warnings={version.contentWarnings} />
              <BibleEditor key={version.id} version={version} onSaved={refresh} />
            </section>
            <ReferencePanel
              subject="character"
              versionPath="character-versions"
              versionId={version.id}
              versionStatus={version.status}
              references={data.references}
              outfits={data.outfits}
              onChanged={refresh}
              trashed={Boolean(ch.deletedAt)}
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={trashOpen}
        title={`将“${ch.name}”移至回收站？`}
        danger
        confirmLabel="移入回收站"
        busy={trash.isPending}
        onClose={() => setTrashOpen(false)}
        onConfirm={() => trash.mutate()}
      >
        可以从角色回收站恢复此角色，画格会保留原有参考图。
      </ConfirmDialog>
      <MigrateModal
        open={migrateOpen}
        onClose={() => setMigrateOpen(false)}
        characterId={characterId}
        versions={versions}
        onDone={refresh}
      />
    </div>
  );
}

function BibleEditor({ version, onSaved }: { version: CharacterVersionRow; onSaved: () => void }) {
  const projectId = useProjectId();
  const [bible, setBible] = useState<CharacterBible>(version.description);
  const editable = version.status === "draft";
  const { state } = useAutosave(
    bible,
    async (b) => {
      await patch(`/character-versions/${version.id}`, { description: b, immutableTraits: b.immutableTraits });
      onSaved();
    },
    { enabled: editable },
  );
  const p = { value: bible, onChange: setBible, disabled: !editable };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        {editable && (
          <DescribeImageButton
            projectId={projectId}
            aspect="character"
            label="从图片填写"
            title="从参考图提取角色描述"
            className="btn-secondary px-2 py-1 text-xs"
            onUse={(d: ImageDescription) => {
              // Merge rather than replace: only fields the image actually described are written, so existing
              // notes the model could not see survive.
              const from = (d.character ?? {}) as Partial<CharacterBible>;
              const filled = Object.fromEntries(
                Object.entries(from).filter(([, v]) => (Array.isArray(v) ? v.length : String(v ?? "").trim())),
              );
              setBible((b) => ({ ...b, ...filled }) as CharacterBible);
              toast.info(`已根据图片填充 ${Object.keys(filled).length} 个字段，请检查内容，修改将自动保存。`);
            }}
          />
        )}
        <SaveIndicator state={state} />
      </div>
      <TextRow {...p} k="summary" label="摘要" multiline />
      <FieldGroup title="身份">
        <TextRow {...p} k="genderPresentation" label="性别表现" />
        <TextRow {...p} k="ageRange" label="年龄／年龄范围" />
        <TextRow {...p} k="height" label="身高" />
        <TextRow {...p} k="build" label="体型" />
      </FieldGroup>
      <FieldGroup title="面部">
        <TextRow {...p} k="faceShape" label="脸型" />
        <TextRow {...p} k="skinTone" label="肤色" />
        <TextRow {...p} k="eyes" label="眼睛" />
        <TextRow {...p} k="eyebrows" label="眉毛" />
        <TextRow {...p} k="nose" label="鼻子" />
        <TextRow {...p} k="mouth" label="嘴巴" />
        <ListRow {...p} k="distinctiveFeatures" label="显著特征" />
      </FieldGroup>
      <FieldGroup title="头发">
        <TextRow {...p} k="hair" label="头发" />
        <TextRow {...p} k="facialHair" label="面部毛发" />
      </FieldGroup>
      <FieldGroup title="服装与装备">
        <TextRow {...p} k="wardrobe" label="默认服装" multiline />
        <ListRow {...p} k="accessories" label="配饰" />
        <ListRow {...p} k="weapons" label="武器" />
        <ListRow {...p} k="props" label="道具" />
      </FieldGroup>
      <FieldGroup title="性格">
        <TextRow {...p} k="personality" label="性格" />
        <TextRow {...p} k="visualMannerisms" label="外在习惯动作" />
        <TextRow {...p} k="defaultExpression" label="默认表情" />
      </FieldGroup>
      <FieldGroup title="一致性">
        <div className="sm:col-span-2">
          <ListRow {...p} k="immutableTraits" label="固定外观特征（始终保持）" />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <span className="label">服装变体（文字描述）</span>
          {bible.outfitVariants.map((o, i) => (
            <div key={i} className="flex gap-2">
              <input
                className="input w-40"
                value={o.name}
                disabled={!editable}
                aria-label="变体名称"
                onChange={(e) =>
                  setBible({
                    ...bible,
                    outfitVariants: bible.outfitVariants.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  })
                }
              />
              <input
                className="input"
                value={o.description}
                disabled={!editable}
                aria-label="变体描述"
                onChange={(e) =>
                  setBible({
                    ...bible,
                    outfitVariants: bible.outfitVariants.map((x, j) =>
                      j === i ? { ...x, description: e.target.value } : x,
                    ),
                  })
                }
              />
              {editable && (
                <button
                  type="button"
                  className="btn-ghost"
                  aria-label="移除变体"
                  onClick={() => setBible({ ...bible, outfitVariants: bible.outfitVariants.filter((_, j) => j !== i) })}
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          ))}
          {editable && (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() =>
                setBible({ ...bible, outfitVariants: [...bible.outfitVariants, { name: "变体", description: "" }] })
              }
            >
              <Plus className="size-3" /> 添加变体
            </button>
          )}
        </div>
      </FieldGroup>
    </div>
  );
}

/** Wording in prompt-visible fields that image moderators often block; suggestions only, nothing is changed. */
function ContentWarnings({ warnings }: { warnings: ContentWarning[] }) {
  if (!warnings.length) return null;
  return (
    <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <div className="mb-1 flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle className="size-4" /> 容易触发图像审核的措辞
      </div>
      <p className="muted mb-2 text-xs">
        这些字段会随角色出现的每个画格一同发送。体型与伤势描述组合后可能触发图像审核。修改描述后，请重新生成参考图，使图片与新描述一致。
      </p>
      <ul className="space-y-1 text-xs">
        {warnings.map((w, i) => (
          <li key={`${w.field}-${w.match}-${i}`}>
            <b>{w.field}</b>: “{w.match}” → 可改为“{w.suggestion}”<span className="muted"> · {w.excerpt}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MigrateModal({
  open,
  onClose,
  characterId,
  versions,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  characterId: string;
  versions: CharacterDetail["versions"];
  onDone: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [blocked, setBlocked] = useState<string | null>(null);
  const migrate = useAction(
    async (force: boolean) => {
      try {
        return await post<{ migrated: number }>(`/characters/${characterId}/migrate-panels`, {
          fromVersionId: from,
          toVersionId: to,
          force,
        });
      } catch (e) {
        if (e instanceof ApiError && e.code === "no_approved_reference") {
          setBlocked(e.message);
          return null;
        }
        throw e;
      }
    },
    {
      success: (r) => (r ? `Migrated ${r.migrated} panel(s)` : ""),
      onSuccess: (r) => {
        if (!r) return;
        setBlocked(null);
        onDone();
        onClose();
      },
    },
  );
  const opt = versions.map((v) => (
    <option key={v.id} value={v.id}>
      v{v.versionNumber} ({v.status}, {v.panelCount} 个画格）
    </option>
  ));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="将画格迁移到其他版本"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!from || !to || from === to || migrate.isPending}
            onClick={() => migrate.mutate(Boolean(blocked))}
          >
            {blocked ? "仍然迁移" : "迁移"}
          </button>
        </>
      }
    >
      {blocked && <p className="mb-3 rounded-lg bg-amber-500/10 p-2 text-sm text-amber-700">{blocked}</p>}
      <p className="muted mb-3 text-sm">引用源版本的画格将在下次生成时采用目标版本的外观和参考图，现有图片会保留。</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="label">起始</span>
          <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">请选择……</option>
            {opt}
          </select>
        </label>
        <label>
          <span className="label">目标</span>
          <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">请选择……</option>
            {opt}
          </select>
        </label>
      </div>
    </Modal>
  );
}
