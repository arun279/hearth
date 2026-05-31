import { Check, Loader2 } from "lucide-react";
import { cn } from "./cn.ts";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type SaveIndicatorProps = {
  readonly status: SaveStatus;
  /** Label for the saved state, e.g. "Saved" or "Saved 2s ago". */
  readonly savedLabel?: string;
  readonly onRetry?: () => void;
  readonly className?: string;
};

/**
 * Persistent autosave status pill. Renders nothing while idle; otherwise
 * announces the current state via `aria-live` so screen-reader users hear
 * "Saving…" / "Saved" / the failure without focus moving. The failure state
 * keeps a retry affordance inline (the call site shows a one-off toast for
 * the failure; this pill is the durable signal, not a toast per keystroke).
 */
export function SaveIndicator({
  status,
  savedLabel = "Saved",
  onRetry,
  className,
}: SaveIndicatorProps) {
  if (status === "idle") return null;
  const base = "inline-flex items-center gap-1 text-[11px]";
  if (status === "saving") {
    return (
      <span className={cn(base, "text-[var(--color-ink-2)]", className)} aria-live="polite">
        <Loader2 size={11} strokeWidth={1.75} className="animate-spin" aria-hidden="true" />
        Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className={cn(base, "text-[var(--color-ink-2)]", className)} aria-live="polite">
        <Check size={11} strokeWidth={1.75} aria-hidden="true" />
        {savedLabel}
      </span>
    );
  }
  return (
    <span className={cn(base, "text-[var(--color-danger)]", className)} role="status">
      Couldn't save
      {onRetry ? (
        <button type="button" onClick={onRetry} className="underline hover:no-underline">
          retry
        </button>
      ) : null}
    </span>
  );
}
