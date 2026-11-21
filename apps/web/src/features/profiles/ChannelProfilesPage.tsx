import type { ChannelProfile, ProjectSettings } from "@openmanga/schemas";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { assetUrl, del, get, patch, post } from "../../api/client.ts";
import { useAction, useMe } from "../../api/hooks.ts";
import type { TtsStatus } from "../../api/types.ts";
import { ConfirmDialog, EmptyState, Field, PageHeader, Spinner } from "../../components/ui.tsx";
import { PronunciationSection } from "../project/PronunciationSection.tsx";
import { LetteringSection } from "../project/SettingsPage.tsx";
import { PublishingSection, VideoSection } from "../project/VideoSettings.tsx";
import { useProfiles } from "./ApplyProfile.tsx";

type Settings = ChannelProfile["settings"];
type Draft = { id: string | null; name: string; description: string; preset: string | null; settings: Settings };
type Presets = { presets: { key: string; name: string }[]; templates: { id: string; name: string }[] };
type Runtime = NonNullable<ProjectSettings["targetRuntime"]>;

const usePresets = () =>
  useQuery({ queryKey: ["production-presets"], queryFn: () => get<Presets>("/production-presets") });

/**
 * Channel profiles: the account's publication identities. A profile is who publishes (voice, branding, thumbnail
 * and YouTube rules, export shape); a preset or template is what kind of project it is. A profile names one to
 * start from, and every project made from it copies both.
 */
export function ChannelProfilesPage() {
  const profiles = useProfiles();
  const presets = usePresets();
  const { data: me } = useMe();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<ChannelProfile | null>(null);
  const remove = useAction((id: string) => del(`/channel-profiles/${id}`), {
    invalidate: [["channel-profiles"]],
    success: "配置已删除",
  });
  const presetName = (key: string | null) =>
    !key
      ? "无预设"
      : key.startsWith("template:")
        ? `模板 ${presets.data?.templates.find((t) => `template:${t.id}` === key)?.name ?? "（已删除）"}`
        : (presets.data?.presets.find((p) => p.key === key)?.name ?? key);
  if (draft) return <ProfileEditor draft={draft} presets={presets.data} onDone={() => setDraft(null)} />;
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <PageHeader
        title="频道配置"
        subtitle="应用到新项目的频道设置，包括旁白、品牌标识、缩略图、YouTube 规则及导出格式。"
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() =>
              setDraft({
                id: null,
                name: "",
                description: "",
                preset: null,
                settings: me?.settings?.narrationVoice ? { narrationVoice: me.settings.narrationVoice } : {},
              })
            }
          >
            <Plus className="size-4" /> 新建配置
          </button>
        }
      />
      <p className="muted text-sm">
        <strong>模板</strong>或预设用于设置项目类型、格式和风格。<strong>频道配置</strong>
        用于设置发布身份，也可指定起始预设或模板。在新建项目向导中选择频道配置会一并复制这些设置。项目保留独立副本，可在概览中选择
        <em>重新应用配置</em>来同步后续修改，也可从项目设置中保存频道配置。
      </p>
      {profiles.isLoading && <Spinner />}
      {profiles.data && !profiles.data.profiles.length && (
        <EmptyState title="暂无频道配置">创建配置，或从项目设置中保存配置。</EmptyState>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {profiles.data?.profiles.map((p) => {
          const logo = p.settings.video?.watermark?.assetId;
          return (
            <li key={p.id} className="card flex gap-3 p-4">
              {logo && (
                <img
                  src={assetUrl(logo)}
                  alt=""
                  className="size-12 shrink-0 rounded border border-[var(--border)] bg-[var(--panel-2)] object-contain p-1"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.name}</div>
                {p.description && <div className="muted line-clamp-2 text-xs">{p.description}</div>}
                <div className="muted mt-1 text-xs">
                  起始预设 {presetName(p.preset)} · {Object.keys(p.settings).length} 项设置
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() =>
                      setDraft({
                        id: p.id,
                        name: p.name,
                        description: p.description,
                        preset: p.preset,
                        settings: p.settings,
                      })
                    }
                  >
                    编辑
                  </button>
                  <Link to="/projects/new" search={{ profile: p.id }} className="btn-secondary text-xs">
                    新建项目
                  </Link>
                  <button type="button" className="btn-ghost text-xs text-red-500" onClick={() => setDeleting(p)}>
                    删除
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={Boolean(deleting)}
        danger
        title={`删除频道配置“${deleting?.name}”？`}
        confirmLabel="删除"
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
          setDeleting(null);
        }}
      >
        已使用此配置的项目会保留各自的设置和标志副本。
      </ConfirmDialog>
    </div>
  );
}

const KEEP = "沿用项目设置";

function ProfileEditor({ draft, presets, onDone }: { draft: Draft; presets?: Presets; onDone: () => void }) {
  const [d, setD] = useState(draft);
  const tts = useQuery({ queryKey: ["tts-status"], queryFn: () => get<TtsStatus>("/tts/status"), staleTime: 60_000 });
  const s = d.settings;
  /** Sets a profile setting; undefined leaves it out, so a project keeps its own. */
  const setS = (patch: Partial<Settings>) => {
    const next: Record<string, unknown> = { ...s, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    setD({ ...d, settings: next as Settings });
  };
  const save = useAction(
    () => {
      const body = { name: d.name.trim(), description: d.description, preset: d.preset, settings: s };
      return d.id ? patch(`/channel-profiles/${d.id}`, body) : post("/channel-profiles", body);
    },
    { invalidate: [["channel-profiles"]], success: "配置已保存", onSuccess: onDone },
  );
  const select = <K extends "imageQuality" | "referencePolicy" | "batchPolicy">(
    k: K,
    options: [NonNullable<Settings[K]>, string][],
  ) => (
    <select
      className="input"
      value={s[k] ?? ""}
      onChange={(e) => setS({ [k]: (e.target.value || undefined) as Settings[K] })}
    >
      <option value="">{KEEP}</option>
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
  const rt = s.targetRuntime;
  const setRt = (p: Partial<Runtime>) => rt && setS({ targetRuntime: { ...rt, ...p } });
  const rtNum = (k: keyof Runtime, min: number, max: number, step = 1) => (
    <input
      className="input"
      type="number"
      min={min}
      max={max}
      step={step}
      value={rt?.[k] ?? ""}
      onChange={(e) => e.target.value !== "" && setRt({ [k]: Number(e.target.value) })}
    />
  );
  const voices = tts.data?.voices ?? [];
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <PageHeader
        title={d.id ? `编辑 ${draft.name}` : "新建频道配置"}
        subtitle="选择“沿用项目设置”的选项将沿用预设或项目中的值。"
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={onDone}>
              取消
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!d.name.trim() || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending && <Spinner />} 保存配置
            </button>
          </>
        }
      />
      <section className="card grid gap-3 p-4 sm:grid-cols-2">
        <Field label="名称">
          <input
            className="input"
            maxLength={80}
            value={d.name}
            onChange={(e) => setD({ ...d, name: e.target.value })}
            autoFocus
          />
        </Field>
        <Field label="起始预设" hint="新项目使用的预设或模板，包括类型、格式和风格。">
          <select
            className="input"
            value={d.preset ?? ""}
            onChange={(e) => setD({ ...d, preset: e.target.value || null })}
          >
            <option value="">无预设（在向导中选择）</option>
            {presets?.presets.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
            {presets?.templates.map((t) => (
              <option key={t.id} value={`template:${t.id}`}>
                模板 · {t.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="描述">
            <textarea
              className="input min-h-14"
              maxLength={500}
              value={d.description}
              onChange={(e) => setD({ ...d, description: e.target.value })}
            />
          </Field>
        </div>
      </section>

      <section className="card grid gap-3 p-4 sm:grid-cols-3">
        <h2 className="font-medium sm:col-span-3">制作</h2>
        <Field label="图像质量">
          {select("imageQuality", [
            ["low", "低"],
            ["medium", "中"],
            ["high", "高"],
          ])}
        </Field>
        <Field label="生成参考图的范围">
          {select("referencePolicy", [
            ["all", "全部"],
            ["main", "主要角色和常用场景"],
          ])}
        </Field>
        <Field label="制作费用策略">
          {select("batchPolicy", [
            ["interactive", "全部立即生成"],
            ["images", "图像批量生成"],
            ["hybrid", "文本批量生成"],
            ["cheapest", "全部批量生成"],
          ])}
        </Field>
        <Field label="目标时长">
          <select
            className="input"
            value={rt === undefined ? "" : rt === null ? "none" : "set"}
            onChange={(e) =>
              setS({
                targetRuntime:
                  e.target.value === "set"
                    ? { minutes: 30, wordsPerMinute: 150, minShotSeconds: 4, maxShotSeconds: 8 }
                    : e.target.value === "none"
                      ? null
                      : undefined,
              })
            }
          >
            <option value="">{KEEP}</option>
            <option value="none">不设目标</option>
            <option value="set">设置目标时长</option>
          </select>
        </Field>
        {rt && (
          <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-4">
            <Field label="分钟">{rtNum("minutes", 1, 600)}</Field>
            <Field label="每分钟词数">{rtNum("wordsPerMinute", 80, 260)}</Field>
            <Field label="最短镜头（秒）">{rtNum("minShotSeconds", 1, 30, 0.5)}</Field>
            <Field label="最长镜头（秒）">{rtNum("maxShotSeconds", 2, 60, 0.5)}</Field>
          </div>
        )}
      </section>

      <section className="card grid gap-3 p-4 sm:grid-cols-2">
        <h2 className="font-medium sm:col-span-2">旁白</h2>
        <Field label="音色">
          <select
            className="input"
            value={s.narrationVoice ?? ""}
            onChange={(e) => setS({ narrationVoice: e.target.value || undefined })}
          >
            <option value="">{KEEP}</option>
            {s.narrationVoice && !voices.some((v) => v.id === s.narrationVoice) && (
              <option value={s.narrationVoice}>{s.narrationVoice}</option>
            )}
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} {v.language && `(${v.language})`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="语速（0.5–2 倍）" hint="留空则沿用项目设置。">
          <input
            className="input"
            type="number"
            min={0.5}
            max={2}
            step={0.05}
            value={s.narrationSpeed ?? ""}
            onChange={(e) =>
              setS({
                narrationSpeed: e.target.value === "" ? undefined : Math.min(2, Math.max(0.5, Number(e.target.value))),
              })
            }
          />
        </Field>
      </section>

      {/* An empty dictionary is left out, so projects keep their own; a filled one replaces theirs when applied. */}
      <PronunciationSection
        value={s.pronunciation ?? []}
        voice={s.narrationVoice ?? "af_heart"}
        speed={s.narrationSpeed ?? 1}
        onChange={(v) => setS({ pronunciation: v.length ? v : undefined })}
      />

      <VideoSection
        logoUpload="/channel-profiles/logo"
        projectTitle={d.name}
        value={s.video}
        onChange={(video) => setS({ video })}
      />
      <PublishingSection value={s} onChange={(v) => setS(v)} />
      <LetteringSection value={s.lettering} onChange={(lettering) => setS({ lettering })} />
    </div>
  );
}
