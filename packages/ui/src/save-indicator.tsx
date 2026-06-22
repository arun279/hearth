import { AlertCircle, Check, Loader2 } from "lucide-react";
import { cn } from "./cn.ts";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type SaveIndicatorProps = {
  readonly status: SaveStatus;
  readonly onRetry?: () => void;
  readonly className?: string;
};

/**
 * Persistent autosave status pill. Renders nothing while idle; the quiet
 * "Saving…" / "Saved" states announce politely so screen-reader users hear
 * progress without focus moving. The failure state carries weight
 * proportional to its consequence (the draft is only as safe as the open
 * tab): a danger-tinted pill with an alert icon and `role="alert"`, matching
 * the danger `Callout` used for mutation failures elsewhere. It keeps a retry
 * affordance inline (the call site shows a one-off toast for the failure;
 * this pill is the durable signal, not a toast per keystroke).
 */
export function SaveIndicator({ status, onRetry, className }: SaveIndicatorProps) {
  if (status === "idle") return null;
  const base = "inline-flex items-center gap-1 text-[0.6875rem]";
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
        Saved
      </span>
    );
  }
  return (
    <span
      className={cn(
        base,
        "rounded-[var(--radius-sm)] border border-[var(--color-danger-border)] bg-[var(--color-danger-soft)] px-1.5 py-0.5 font-medium text-[var(--color-danger)]",
        className,
      )}
      role="alert"
    >
      <AlertCircle size={12} strokeWidth={2} aria-hidden="true" />
      Couldn't save
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-[var(--radius-sm)] underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          retry
        </button>
      ) : null}
    </span>
  );
}
