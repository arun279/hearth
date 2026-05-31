import { Button, buttonClasses, Callout } from "@hearth/ui";
import { Link } from "@tanstack/react-router";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * The active Part's honor-system completion state, plus the toggle. Absent
 * (`null`) when there is no active Part to mark. `canMark` is false for a
 * read-only viewer or a closed window — the control is then hidden entirely
 * rather than shown disabled, so no dead, focusable tab stop is left behind.
 */
type Completion = {
  readonly completed: boolean;
  readonly canMark: boolean;
  readonly pending: boolean;
  readonly onToggle: () => void;
};

type Props = {
  readonly previousPartId: string | null;
  readonly nextPartId: string | null;
  readonly onNavigate: (partId: string) => void;
  readonly groupId: string;
  readonly trackId: string;
  readonly completion: Completion | null;
  /**
   * True once every Part carries the participant's completion mark. Drives the
   * "all parts complete" closure note. Honest scope: this is per-Part marking
   * only — the activity-level completion record arrives in M11, so the copy
   * never claims the activity itself is complete.
   */
  readonly allPartsComplete: boolean;
};

/**
 * Sticky footer for the Activity Player: Previous on the left, the
 * mark-complete toggle in the middle (when the viewer may mark), and a
 * forward affordance on the right — Next mid-flow, or a "Back to track"
 * closure link on the last (or only) Part.
 *
 * Completion is honor-system: the toggle is always enabled regardless of a
 * reflection's `minWords` or a quiz's score — it stays live so the
 * participant decides when a Part is done. A completed Part flips the button
 * to a "Completed" state that un-marks on click, so the action is reversible.
 * "Back to track" navigates without claiming completion; the two are separate
 * affordances.
 *
 * The Previous/Next labels collapse to icon-only below `sm` (their accessible
 * name stays via `aria-label`) and the control row wraps if it still can't
 * fit, so nothing overflows down to a 320px viewport. On the last Part the
 * forward affordance becomes the primary finish and Mark-complete steps down
 * to secondary — at most one filled-primary button per state.
 */
export function PartFooter({
  previousPartId,
  nextPartId,
  onNavigate,
  groupId,
  trackId,
  completion,
  allPartsComplete,
}: Props) {
  const isLastPart = nextPartId === null;
  const activePartComplete = completion?.completed ?? false;
  // On the last Part, "Back to track" is the finish action. It claims primary
  // emphasis only once there's nothing left to mark here — while the active
  // Part is still incomplete, Mark-complete owns the single primary slot so the
  // two never render filled-blue at once (WCAG-adjacent visual-hierarchy rule).
  const finishIsPrimary = isLastPart && activePartComplete;
  return (
    <footer className="sticky bottom-0 z-10 flex flex-col gap-2 border-[var(--color-rule)] border-t bg-[var(--color-surface)] px-4 py-3 md:px-8">
      {allPartsComplete ? (
        <Callout tone="good" className="py-2">
          All parts complete — you've marked every part of this activity done.
        </Callout>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => previousPartId && onNavigate(previousPartId)}
          disabled={previousPartId === null}
          size="sm"
          aria-label="Previous part"
        >
          <ChevronLeft size={14} strokeWidth={1.5} aria-hidden="true" />
          <span className="hidden sm:inline">Previous</span>
        </Button>
        {completion?.canMark ? (
          <MarkCompleteButton completion={completion} demoteToSecondary={finishIsPrimary} />
        ) : null}
        {isLastPart ? (
          <Link
            to="/g/$groupId/t/$trackId"
            params={{ groupId, trackId }}
            className={buttonClasses(finishIsPrimary ? "primary" : "secondary", "sm")}
          >
            Back to track
          </Link>
        ) : (
          <Button
            type="button"
            variant="primary"
            onClick={() => nextPartId && onNavigate(nextPartId)}
            size="sm"
            aria-label="Next part"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
          </Button>
        )}
      </div>
    </footer>
  );
}

/**
 * The honor-system toggle. A single stable `<button>` whose label, icon tone,
 * `variant`, and `aria-pressed` all update in place — never conditionally
 * remounted, no changing React key. It also stays ENABLED while the toggle is
 * in flight: disabling a focused button moves focus to `<body>`, so an in-flight
 * `disabled` would drop the keyboard user after Enter/Space. Instead `aria-busy`
 * announces the pending state and the handler short-circuits a re-entrant click,
 * so focus and the focus ring stay on the control (WCAG 2.4.7).
 *
 * `demoteToSecondary` forces the incomplete state to render secondary on the
 * last Part, where "Back to track" is the primary finish; everywhere else the
 * incomplete state is the footer's primary call to action.
 */
function MarkCompleteButton({
  completion,
  demoteToSecondary,
}: {
  readonly completion: Completion;
  readonly demoteToSecondary: boolean;
}) {
  const { completed, pending, onToggle } = completion;
  const variant = completed || demoteToSecondary ? "secondary" : "primary";
  return (
    <Button
      type="button"
      variant={variant}
      onClick={() => {
        if (!pending) onToggle();
      }}
      aria-busy={pending}
      size="sm"
      aria-pressed={completed}
    >
      <Check size={14} strokeWidth={1.75} aria-hidden="true" />
      {completed ? "Completed" : "Mark complete"}
    </Button>
  );
}
