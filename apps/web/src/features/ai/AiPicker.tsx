import {
  type AiCapability as AnyCapability,
  PROVIDER_CATALOG,
  type ProviderKind,
  providerCatalog,
} from "@openmanga/domain/browser";

/** Text, image and voice runs; video clips have their own picker with prices (ClipPanel). */
type AiCapability = Exclude<AnyCapability, "video">;

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Cpu, KeyRound, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { del, get, post } from "../../api/client.ts";
import { ConfirmDialog, clsx, ErrorBox, Field, fmt, Popover, Spinner, toast } from "../../components/ui.tsx";

export type Credential = {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl: string | null;
  keyHint: string;
  lastUsedAt: string | null;
  createdAt: string;
};
type AiOptions = {
  defaults: {
    /** null unless the server runs in demo (mock) mode: keys are your own. */
    text: { provider: string; model: string } | null;
    image: { provider: string; model: string; quality: string } | null;
    tts: { provider: string } | null;
  };
  mockMode: boolean;
  credentials: Credential[];
};
type Choice = {
  credentialId: string | null;
  provider?: ProviderKind | null;
  model: string;
  voice?: string;
  /** Text only: run with no provider at all and answer the prompt by hand. */
  manual?: boolean;
};

export const aiOptionsKey = ["ai-options"] as const;
export const useAiOptions = () =>
  useQuery({ queryKey: aiOptionsKey, queryFn: () => get<AiOptions>("/ai/options"), staleTime: 60_000 });

/** Last provider/model per capability, remembered in this browser (keys themselves live on the server). */
export const useAiChoices = create<{
  text: Choice;
  image: Choice;
  tts: Choice;
  set: (cap: AiCapability, c: Partial<Choice>) => void;
}>()(
  persist(
    (set) => ({
      text: { credentialId: null, model: "" },
      image: { credentialId: null, model: "" },
      tts: { credentialId: null, model: "", voice: "" },
      set: (cap, c) => set((s) => ({ [cap]: { ...s[cap], ...c } })),
    }),
    { name: "mf-ai-choices" },
  ),
);

const supports = (kind: ProviderKind, cap: AiCapability) => {
  const p = providerCatalog(kind);
  if (!p) return false;
  if (p.kind === "openai_compatible") return true;
  return (cap === "text" ? p.textModels : cap === "image" ? p.imageModels : p.ttsModels).length > 0;
};

/**
 * The key a run will actually use: the remembered one, else the first usable one when the server has no default
 * of its own (the normal BYOK case — otherwise a run would 422 until the user opened the picker).
 */
export function effectiveCredential(cap: AiCapability, c: Choice, o: AiOptions | undefined) {
  const creds = (o?.credentials ?? []).filter((x) => supports(x.kind, cap));
  return creds.find((x) => x.id === c.credentialId) ?? (o && !o.defaults[cap] ? creds[0] : undefined) ?? null;
}

/**
 * Request body fragment for the current choice of a capability. Falls back to the server default when the
 * remembered key was deleted. For narration voice, also returns the chosen voice.
 */
export function aiBody(cap: AiCapability, o: AiOptions | undefined) {
  const c = useAiChoices.getState()[cap];
  // Manual answers nothing about a provider, so it has to short-circuit before any credential is considered:
  // the whole point is that there is no key to fall back to.
  if (cap === "text" && c.manual) return { ai: { manual: true } };
  const valid = effectiveCredential(cap, c, o)?.id ?? null;
  if (!valid && !c.model.trim()) return {};
  const body: { ai: { credentialId: string | null; model: string | null }; voice?: string } = {
    ai: { credentialId: valid, model: c.model.trim() || null },
  };
  if (cap === "tts" && valid && c.voice) body.voice = c.voice;
  return body;
}

/** Hook form of aiBody that re-renders when the choice or saved keys change. */
export function useAiBody(cap: AiCapability) {
  const opts = useAiOptions();
  useAiChoices((s) => s[cap]);
  return () => aiBody(cap, opts.data);
}

function choiceLabel(cap: AiCapability, c: Choice, o: AiOptions | undefined) {
  if (cap === "text" && c.manual) return "手动粘贴 · 无需密钥";
  const cred = effectiveCredential(cap, c, o);
  if (cred) {
    const cat = providerCatalog(cred.kind);
    const models = cap === "text" ? cat?.textModels : cap === "image" ? cat?.imageModels : cat?.ttsModels;
    return `${cred.label} · ${c.model || models?.[0] || "请选择模型"}`;
  }
  if (!o) return "…";
  if (cap === "tts") return `本地 · ${o.defaults.tts?.provider ?? "已禁用"}`;
  const d = o.defaults[cap];
  if (!d) return "未选择密钥";
  return `演示 · ${d.provider} · ${c.model || d.model}`;
}

/** Provider + model (and voice for narration) selector for one capability. */
export function ModelPicker({ cap }: { cap: AiCapability }) {
  const id = useId();
  const opts = useAiOptions();
  const choice = useAiChoices((s) => s[cap]);
  const setChoice = useAiChoices((s) => s.set);
  const creds = (opts.data?.credentials ?? []).filter((c) => supports(c.kind, cap));
  const cred = effectiveCredential(cap, choice, opts.data);
  const models = useQuery({
    queryKey: ["ai-models", cred?.id, cap],
    queryFn: () => get<{ models: string[] }>(`/ai/credentials/${cred!.id}/models?capability=${cap}`),
    enabled: Boolean(cred) && cap !== "tts",
    staleTime: 10 * 60_000,
    retry: false,
  });
  const ttsModelsQ = useQuery({
    queryKey: ["ai-models", cred?.id, "tts"],
    queryFn: () => get<{ models: string[] }>(`/ai/credentials/${cred!.id}/models?capability=tts`),
    enabled: Boolean(cred) && cap === "tts",
    staleTime: 10 * 60_000,
    retry: false,
  });
  const voices = useQuery({
    queryKey: ["ai-voices", cred?.id ?? "default", choice.model],
    queryFn: () =>
      get<{ voices: { id: string; name: string; language: string; gender?: string }[] }>(
        cred ? `/ai/voices?credentialId=${cred.id}&model=${encodeURIComponent(choice.model)}` : "/ai/voices",
      ),
    enabled: cap === "tts" && Boolean(cred),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const cat = cred ? providerCatalog(cred.kind) : null;
  const suggestions =
    (cap === "tts" ? ttsModelsQ.data?.models : models.data?.models) ??
    (cap === "text" ? cat?.textModels : cap === "image" ? cat?.imageModels : cat?.ttsModels) ??
    [];
  const d = opts.data?.defaults;
  const defaultModel = cap === "tts" ? "" : (d?.[cap]?.model ?? "");
  const listErr = (cap === "tts" ? ttsModelsQ.error : models.error) ?? voices.error;

  return (
    <div className="space-y-2 text-sm">
      <Field label={cap === "text" ? "文本提供商" : cap === "image" ? "图像提供商" : "语音提供商"}>
        <select
          className="input"
          value={choice.manual ? "manual" : (cred?.id ?? "")}
          onChange={(e) =>
            setChoice(cap, {
              credentialId: e.target.value === "manual" ? null : e.target.value || null,
              provider: null,
              model: "",
              voice: "",
              manual: e.target.value === "manual",
            })
          }
        >
          <option value="">
            {cap === "tts"
              ? `本地 ${d?.tts?.provider ?? "TTS"}`
              : opts.data?.mockMode
                ? "演示提供商（模拟）"
                : creds.length
                  ? "选择密钥…"
                  : "尚未添加密钥"}
          </option>
          {creds.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} — {providerCatalog(c.kind)?.label} {c.keyHint}
            </option>
          ))}
          {/* Text only: an image cannot be pasted back as text, so a panel takes an upload instead. */}
          {cap === "text" && <option value="manual">手动粘贴，无需密钥</option>}
        </select>
      </Field>
      {(cap !== "tts" || cred) && (
        <Field label="模型">
          <input
            className="input"
            list={`${id}-models`}
            placeholder={cred ? (suggestions[0] ?? "模型 ID") : defaultModel}
            value={choice.model}
            onChange={(e) => setChoice(cap, { model: e.target.value })}
          />
          <datalist id={`${id}-models`}>
            {(cred ? suggestions : [defaultModel]).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
      )}
      {cap === "tts" && cred && (
        <Field label="音色">
          <select
            className="input"
            value={choice.voice ?? ""}
            onChange={(e) => setChoice("tts", { voice: e.target.value })}
            disabled={voices.isLoading}
          >
            <option value="">{voices.isLoading ? "正在加载音色…" : "首个可用音色"}</option>
            {voices.data?.voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.language ? ` · ${v.language}` : ""}
                {v.gender ? ` · ${v.gender}` : ""}
              </option>
            ))}
          </select>
        </Field>
      )}
      {cap === "tts" && !cred && <p className="muted text-xs">使用下方项目默认的音色和语速（本地 Kokoro）。</p>}
      {listErr ? (
        <p className="text-xs text-amber-600">无法获取模型或音色列表 {String((listErr as Error).message)}</p>
      ) : null}
      {!creds.length && cap !== "tts" && (
        <p className="text-xs text-amber-600">
          此服务器没有共享的 API 密钥。{" "}
          <Link to="/account" className="underline">
            添加自己的 API 密钥
          </Link>{" "}
          以选择 OpenAI、Anthropic、Google、Meta、OpenRouter、ElevenLabs 等提供商。
        </p>
      )}
    </div>
  );
}

/** Compact "via provider · model" button that opens the picker; place it next to a generate button. */
export function AiChip({ cap, className }: { cap: AiCapability; className?: string }) {
  const opts = useAiOptions();
  const choice = useAiChoices((s) => s[cap]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div className={clsx("inline-block max-w-full", className)}>
      <button
        ref={ref}
        type="button"
        className="btn-ghost max-w-64 truncate px-2 py-1 text-xs"
        aria-expanded={open}
        aria-label={`${{ text: "文本", image: "图像", tts: "语音" }[cap]}模型 ${choiceLabel(cap, choice, opts.data)}`}
        title="为本次生成选择提供商和模型"
        onClick={() => setOpen((o) => !o)}
      >
        <Cpu className="size-3.5 shrink-0" />
        <span className="truncate">{choiceLabel(cap, choice, opts.data)}</span>
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} className="w-80 max-w-[90vw] p-3">
        <ModelPicker cap={cap} />
      </Popover>
    </div>
  );
}

/** Account settings: bring-your-own-key management. */
export function ProviderKeys() {
  const qc = useQueryClient();
  const opts = useAiOptions();
  const [form, setForm] = useState<{ kind: ProviderKind; label: string; apiKey: string; baseUrl: string }>({
    kind: "openai",
    label: "",
    apiKey: "",
    baseUrl: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [removing, setRemoving] = useState<Credential | null>(null);
  const cat = providerCatalog(form.kind)!;
  const caps = (k: ProviderKind) =>
    (["text", "image", "tts"] as const)
      .filter((c) => supports(k, c))
      .map((c) => ({ text: "文本", image: "图像", tts: "语音" })[c]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await post("/ai/credentials", {
        kind: form.kind,
        label: form.label,
        apiKey: form.apiKey,
        baseUrl: form.kind === "openai_compatible" ? form.baseUrl : null,
      });
      setForm({ ...form, label: "", apiKey: "", baseUrl: "" });
      toast.success("密钥已验证并保存");
      await qc.invalidateQueries({ queryKey: aiOptionsKey });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4" />
        <h2 className="font-medium">AI 提供商（使用自己的密钥）</h2>
      </div>
      <p className="muted text-xs">
        添加密钥后，即可为每次文本、图像或旁白生成选择提供商和模型。密钥经提供商验证后加密存储在服务器上，仅供你使用，保存后无法再次查看。未添加密钥时，使用服务器配置的提供商。密钥产生的用量由提供商向你计费。
      </p>
      {opts.isLoading && <Spinner />}
      <ErrorBox error={opts.error} />
      {opts.data?.credentials.length ? (
        <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {opts.data.credentials.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 p-2 text-sm">
              <span className="font-medium">{c.label}</span>
              <span className="chip">{providerCatalog(c.kind)?.label}</span>
              <span className="muted font-mono text-xs">{c.keyHint}</span>
              <span className="muted text-xs">{caps(c.kind).join(" · ")}</span>
              {c.baseUrl && <span className="muted truncate text-xs">{c.baseUrl}</span>}
              <span className="muted ml-auto text-xs">
                {c.lastUsedAt ? `使用于 ${fmt.ago(c.lastUsedAt)}` : `添加于 ${fmt.ago(c.createdAt)}`}
              </span>
              <button
                type="button"
                className="btn-ghost p-1 text-red-500"
                aria-label={`删除密钥 ${c.label}`}
                onClick={() => setRemoving(c)}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        !opts.isLoading && <p className="muted text-sm">尚未添加密钥。</p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="提供商">
          <select
            className="input"
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as ProviderKind })}
          >
            {PROVIDER_CATALOG.map((p) => (
              <option key={p.kind} value={p.kind}>
                {p.label} ({caps(p.kind).join(", ")})
              </option>
            ))}
          </select>
        </Field>
        <Field label="名称（可选）">
          <input
            className="input"
            placeholder={cat.label}
            value={form.label}
            maxLength={80}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
        </Field>
        {form.kind === "openai_compatible" && (
          <div className="sm:col-span-2">
            <Field label="基础 URL（公网 HTTPS，兼容 OpenAI）">
              <input
                className="input"
                placeholder="https://api.example.com/v1"
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              />
            </Field>
          </div>
        )}
        <div className="sm:col-span-2">
          <Field label="API 密钥">
            <input
              className="input font-mono"
              type="password"
              autoComplete="off"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
          </Field>
          {cat.keyUrl && (
            <a className="muted text-xs underline" href={cat.keyUrl} target="_blank" rel="noreferrer">
              获取 {cat.label} 密钥
            </a>
          )}
        </div>
      </div>
      <ErrorBox error={error} />
      <button
        type="button"
        className="btn-primary"
        disabled={busy || form.apiKey.trim().length < 8 || (form.kind === "openai_compatible" && !form.baseUrl.trim())}
        onClick={save}
      >
        {busy && <Spinner />} 验证并保存密钥
      </button>
      <ConfirmDialog
        open={Boolean(removing)}
        danger
        title={`删除密钥“${removing?.label}”？`}
        confirmLabel="删除密钥"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          try {
            await del(`/ai/credentials/${removing!.id}`);
            await qc.invalidateQueries({ queryKey: aiOptionsKey });
            toast.success("密钥已删除");
          } catch (e) {
            toast.error(e);
          }
          setRemoving(null);
        }}
      >
        使用此密钥的排队任务将失败。后续生成将恢复使用服务器默认提供商。
      </ConfirmDialog>
    </section>
  );
}
