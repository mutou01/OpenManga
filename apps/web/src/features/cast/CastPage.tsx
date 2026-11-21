import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, RotateCcw, Users } from "lucide-react";
import { useState } from "react";
import { get, post } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import type { CastCard } from "../../api/types.ts";
import {
  AssetImage,
  EmptyState,
  ErrorBox,
  Modal,
  PageHeader,
  Spinner,
  StatusChip,
  TagInput,
} from "../../components/ui.tsx";
import { statusLabel } from "../../lib/locale.ts";
import { BulkGenerateButton } from "../pages/BulkGenerate.tsx";
import { useProjectId } from "../project/ProjectLayout.tsx";

const ROLES = {
  protagonist: "主角",
  antagonist: "反派",
  supporting: "配角",
  minor: "次要角色",
};

function roleLabel(role: string) {
  return Object.hasOwn(ROLES, role) ? ROLES[role as keyof typeof ROLES] : role;
}

export function CastPage() {
  const projectId = useProjectId();
  const [trash, setTrash] = useState(false);
  const [role, setRole] = useState("");
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const key = [...qk.cast(projectId), trash] as const;
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: key,
    queryFn: () => get<{ characters: CastCard[] }>(`/projects/${projectId}/characters${trash ? "?trash=1" : ""}`),
  });
  const restore = useAction((id: string) => post(`/characters/${id}/restore`), {
    invalidate: [qk.cast(projectId)],
    success: "角色已恢复",
  });
  const q = text.trim().toLowerCase();
  const list = (data?.characters ?? []).filter(
    (c) =>
      (!role || c.role === role) &&
      (!q || c.name.toLowerCase().includes(q) || c.aliases.some((a) => a.alias.toLowerCase().includes(q))),
  );

  return (
    <div className="p-6">
      <PageHeader
        title="角色"
        subtitle="管理角色、外观版本及身份参考图。"
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => setTrash(!trash)}>
              {trash ? "显示使用中" : "回收站"}
            </button>
            {!trash && (
              <BulkGenerateButton
                projectId={projectId}
                scope={{ references: "character" }}
                label="生成所有角色参考图"
                className="btn-secondary"
                noun={{
                  one: "角色参考图",
                  many: "角色参考图",
                  missing: "仅处理缺少此类参考图的角色",
                }}
                kinds={[
                  { value: "full_body", label: "全身" },
                  { value: "portrait", label: "肖像" },
                  { value: "multi_angle", label: "多角度视图" },
                  { value: "expression_sheet", label: "表情设定图" },
                ]}
              />
            )}
            <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> 添加角色
            </button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="input max-w-xs"
          placeholder="按姓名或别名筛选"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="筛选角色"
        />
        <select
          className="input w-auto"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          aria-label="按角色类型筛选"
        >
          <option value="">所有角色类型</option>
          {Object.entries(ROLES).map(([r, label]) => (
            <option key={r} value={r}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <ErrorBox error={error} onRetry={() => refetch()} />
      {isLoading && <Spinner className="size-6" />}
      {data && !list.length && (
        <EmptyState icon={<Users className="size-8" />} title={trash ? "回收站为空" : "暂无角色"}>
          {trash ? null : "分析故事以自动提取角色，或手动添加角色。"}
        </EmptyState>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {list.map((c) => (
          <div key={c.id} className="card overflow-hidden">
            <Link
              to="/projects/$projectId/cast/$characterId"
              params={{ projectId, characterId: c.id }}
              className="block"
            >
              <AssetImage
                assetId={c.portraitAssetId}
                alt={`${c.name}的肖像`}
                className="aspect-[3/4] w-full"
                trashed={trash}
              />
            </Link>
            <div className="space-y-1 p-3">
              <Link
                to="/projects/$projectId/cast/$characterId"
                params={{ projectId, characterId: c.id }}
                className="block truncate font-medium hover:underline"
              >
                {c.name}
              </Link>
              <div className="muted flex items-center gap-2 text-xs capitalize">
                {roleLabel(c.role)}
                {c.currentVersion && (
                  <span>
                    · 第 {c.currentVersion.versionNumber} 版 {statusLabel(c.currentVersion.status)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1 text-xs">
                <StatusChip status={c.referenceStatus} label={`参考图：${statusLabel(c.referenceStatus)}`} />
                {c.sourceId && (
                  <span className="chip" title="关联系列素材库，请在系列中修改后同步">
                    来自系列
                  </span>
                )}
                {c.staleReferences > 0 && (
                  <span className="chip bg-amber-500/15 text-amber-600" title="参考图基于旧版描述生成">
                    参考图已过时
                  </span>
                )}
                {c.contentWarnings > 0 && (
                  <span className="chip bg-amber-500/15 text-amber-600" title="描述中包含容易触发图像审核的措辞">
                    {c.contentWarnings} 条措辞提示{c.contentWarnings === 1 ? "" : "s"}
                  </span>
                )}
                <span className="muted">{c.appearances} 个画格</span>
              </div>
              {c.aliases.length > 0 && (
                <div className="muted truncate text-xs" title={c.aliases.map((a) => a.alias).join(", ")}>
                  别名 {c.aliases.map((a) => a.alias).join(", ")}
                </div>
              )}
              {trash && (
                <button
                  type="button"
                  className="btn-secondary mt-1 w-full text-xs"
                  onClick={() => restore.mutate(c.id)}
                >
                  <RotateCcw className="size-3" /> 恢复
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <AddCharacterModal open={adding} onClose={() => setAdding(false)} projectId={projectId} />
    </div>
  );
}

function AddCharacterModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const empty = {
    name: "",
    role: "supporting",
    aliases: [] as string[],
    genderPresentation: "",
    ageRange: "",
    hair: "",
    eyes: "",
    build: "",
    wardrobe: "",
    summary: "",
  };
  const [f, setF] = useState(empty);
  const create = useAction(
    () =>
      post(`/projects/${projectId}/characters`, {
        name: f.name,
        role: f.role,
        aliases: f.aliases,
        description: {
          genderPresentation: f.genderPresentation,
          ageRange: f.ageRange,
          hair: f.hair,
          eyes: f.eyes,
          build: f.build,
          wardrobe: f.wardrobe,
          summary: f.summary,
        },
      }),
    {
      invalidate: [qk.cast(projectId)],
      success: "角色已添加",
      onSuccess: () => {
        setF(empty);
        onClose();
      },
    },
  );
  const text = (k: keyof typeof empty, label: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" value={f[k] as string} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="添加角色"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!f.name.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending && <Spinner />} 创建
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {text("name", "名称")}
        <label className="block">
          <span className="label">角色类型</span>
          <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {Object.entries(ROLES).map(([r, label]) => (
              <option key={r} value={r}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {text("genderPresentation", "性别表现")}
        {text("ageRange", "年龄范围")}
        {text("hair", "头发")}
        {text("eyes", "眼睛")}
        {text("build", "体型")}
        {text("wardrobe", "默认服装")}
        <div className="sm:col-span-2">
          <span className="label">别名</span>
          <TagInput value={f.aliases} onChange={(aliases) => setF({ ...f, aliases })} placeholder="男孩、学生……" />
        </div>
        <label className="block sm:col-span-2">
          <span className="label">摘要</span>
          <textarea
            className="input min-h-16"
            value={f.summary}
            onChange={(e) => setF({ ...f, summary: e.target.value })}
          />
        </label>
      </div>
    </Modal>
  );
}
