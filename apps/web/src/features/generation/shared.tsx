import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "../../components/ui.tsx";

export { KIND_LABELS, kindLabel } from "../../lib/locale.ts";

export const JOB_STATUSES = [
  "queued",
  "awaiting_input",
  "processing",
  "completed",
  "failed",
  "cancel_requested",
  "cancelled",
] as const;

export function CopyButton({ text, label = "复制" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch (e) {
          toast.error(e);
        }
      }}
    >
      {done ? <Check className="size-4" /> : <Copy className="size-4" />} {done ? "已复制" : label}
    </button>
  );
}

export function JsonBlock({ value, maxHeight = "20rem" }: { value: unknown; maxHeight?: string }) {
  return (
    <pre
      className="overflow-auto rounded-lg bg-[var(--panel-2)] p-3 font-mono text-xs leading-relaxed"
      style={{ maxHeight }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "进度"}
      className="h-2 w-full overflow-hidden rounded-full bg-[var(--panel-2)]"
    >
      <div className="h-full bg-accent-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}
