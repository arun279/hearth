import { Check, Loader2, TriangleAlert } from "lucide-react";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Quiet save-state pill for the reflection autosave. Stays out of the way
 * (`idle` renders nothing) and never throws a toast on every keystroke —
 * the persistent state lives here; a single toast covers a failure burst.
 */
export function SaveIndicator({
  status,
  onRetry,
}: {
  readonly status: SaveStatus;
  readonly onRetry?: () => void;
}) {
  if (status === "idle") return null;
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-ink-2)]">
        <Loader2 size={12} strokeWidth={1.75} className="animate-spin" aria-hidden="true" />
        Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-ink-2)]">
        <Check size={12} strokeWidth={1.75} aria-hidden="true" />
        Saved
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-danger)]">
      <TriangleAlert size={12} strokeWidth={1.75} aria-hidden="true" />
      Couldn't save.
      <button type="button" onClick={onRetry} className="underline underline-offset-2">
        Retry
      </button>
    </span>
  );
}
