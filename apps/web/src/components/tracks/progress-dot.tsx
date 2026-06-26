import { cn } from "@hearth/ui";
import { Check } from "lucide-react";

export type ProgressState = "completed" | "in_progress" | "not_started";

const STATE_LABEL: Record<ProgressState, string> = {
  completed: "completed",
  in_progress: "in progress",
  not_started: "not started",
};

export function progressStateLabel(state: ProgressState): string {
  return STATE_LABEL[state];
}

/**
 * One coarse completion cell — the shared atom of the per-activity completion
 * chip and the track progress roster. Carries existence-and-completion only;
 * it is non-interactive (`role="img"`) and reads its meaning through an
 * accessible label so a wrapping row of dots never collapses into one giant
 * button label. Tones follow the design plan's StatusDot: complete = good fill
 * + check, in-progress = accent ring, not-started = rule outline.
 */
export function ProgressDot({
  state,
  label,
}: {
  readonly state: ProgressState;
  readonly label: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border",
        state === "completed"
          ? "border-transparent bg-[var(--color-good)] text-[var(--color-bg)]"
          : state === "in_progress"
            ? "border-2 border-[var(--color-accent)] bg-transparent"
            : "border-[var(--color-ink-3)] bg-transparent",
      )}
    >
      {state === "completed" ? <Check size={9} strokeWidth={3} aria-hidden="true" /> : null}
      {/* Inner dot gives in-progress a shape cue, so it is distinguishable
          from the empty not-started ring without relying on color (WCAG 1.4.1). */}
      {state === "in_progress" ? (
        <span className="size-1.5 rounded-full bg-[var(--color-accent)]" aria-hidden="true" />
      ) : null}
    </span>
  );
}
