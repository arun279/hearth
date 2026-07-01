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
 * The bare visual mark for one completion state — sized circle + shape cue, no
 * accessible role of its own. Shared by the labelled `ProgressDot` (which wraps
 * it in a `role="img"`) and the `ProgressLegend` (where adjacent visible text
 * is the label, so the glyph must stay silent to avoid a double announcement).
 * Tones follow the design plan's StatusDot: complete = good fill + check,
 * in-progress = accent ring + center dot, not-started = rule outline.
 */
function ProgressDotGlyph({ state }: { readonly state: ProgressState }) {
  return (
    <span
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

/**
 * One coarse completion cell — the shared atom of the per-activity completion
 * chip and the track progress roster. Carries existence-and-completion only;
 * it is non-interactive (`role="img"`) and reads its meaning through an
 * accessible label so a wrapping row of dots never collapses into one giant
 * button label.
 */
export function ProgressDot({
  state,
  label,
}: {
  readonly state: ProgressState;
  readonly label: string;
}) {
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex">
      <ProgressDotGlyph state={state} />
    </span>
  );
}

const LEGEND_ORDER: readonly ProgressState[] = ["completed", "in_progress", "not_started"];

const LEGEND_CAPTION: Record<ProgressState, string> = {
  completed: "Complete",
  in_progress: "In progress",
  not_started: "Not started",
};

/**
 * The one decode key shared by both progress surfaces (the roster and the
 * Activities-tab completion chips), so bare dots are recognisable at a glance
 * rather than tooltip-only (Nielsen recognition-over-recall). Each item pairs
 * the real glyph with its visible caption; the glyph stays silent to AT because
 * the caption beside it is the label.
 */
export function ProgressLegend({ className }: { readonly className?: string }) {
  return (
    <ul
      aria-label="Progress key"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-[var(--color-ink-2)]",
        className,
      )}
    >
      {LEGEND_ORDER.map((state) => (
        <li key={state} className="inline-flex items-center gap-1.5">
          <ProgressDotGlyph state={state} />
          {LEGEND_CAPTION[state]}
        </li>
      ))}
    </ul>
  );
}
