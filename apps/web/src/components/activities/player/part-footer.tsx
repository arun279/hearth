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

/**
 * The activity-level completion affordance for the `manual_mark` Completion
 * Rule (the v1 composer default). Absent (`null`) for `all_parts_complete`
 * (the server auto-completes on the last Part) and for read-only / non-author
 * viewers. `completed` flips the closure banner from a "Mark activity complete"
 * call to action to a "good"-tone confirmation, giving the participant the
 * dialog-closure signal the per-Part marks alone never provided.
 */
type ActivityCompletion = {
  readonly completed: boolean;
  readonly pending: boolean;
  readonly onComplete: () => void;
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
   * only under the `all_parts_complete` rule — the copy never claims the
   * activity itself is complete (that is `activityCompletion`'s job).
   */
  readonly allPartsComplete: boolean;
  /** Activity-level completion (the `manual_mark` close affordance + state). */
  readonly activityCompletion: ActivityCompletion | null;
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
 * fit, so nothing overflows down to a 320px viewport. At most one
 * filled-primary button per state: while the active Part is still markable and
 * incomplete, Mark-complete is primary and the forward affordance steps down;
 * once the Part is complete (or the viewer can't mark), the forward affordance
 * (Next, or "Back to track" on the last Part) takes primary.
 */
export function PartFooter({
  previousPartId,
  nextPartId,
  onNavigate,
  groupId,
  trackId,
  completion,
  allPartsComplete,
  activityCompletion,
}: Props) {
  const isLastPart = nextPartId === null;
  const activePartComplete = completion?.completed ?? false;
  // An incomplete activity-level CTA owns the footer's single primary slot — it
  // is the headline close action — so every per-Part/forward control steps down
  // while it shows. Once the activity is complete (or there is no manual CTA),
  // the per-Part hierarchy below resumes.
  const activityCtaIsPrimary = activityCompletion !== null && !activityCompletion.completed;
  // The forward affordance ("Back to track" on the last Part, "Next" otherwise)
  // claims primary emphasis only once there's nothing left to mark here — while
  // the active Part is still incomplete (and the viewer may mark it),
  // Mark-complete owns the single primary slot so the two never render
  // filled-blue at once (one primary per footer; visual-hierarchy rule). Once
  // the Part is complete, Mark-complete steps down and the forward action leads.
  const forwardIsPrimary =
    !activityCtaIsPrimary && (activePartComplete || !(completion?.canMark ?? false));
  const finishIsPrimary = isLastPart && forwardIsPrimary;
  const markCompleteDemoted = forwardIsPrimary || activityCtaIsPrimary;
  return (
    <footer className="sticky bottom-0 z-10 flex flex-col gap-2 border-[var(--color-rule)] border-t bg-[var(--color-surface)] px-4 py-3 md:px-8">
      {activityCompletion ? (
        <ActivityCompletionBanner
          activityCompletion={activityCompletion}
          ctaIsPrimary={activityCtaIsPrimary}
        />
      ) : null}
      {allPartsComplete ? (
        // The strongest closure signal carries the strongest onward action so
        // it's reachable from any Part. On the last Part the footer's own
        // "Back to track" already covers it, so the in-banner link only shows
        // mid-flow (avoids two identical links side by side at the end).
        <Callout tone="good" className="py-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>All parts complete — you've marked every part of this activity done.</span>
            {isLastPart ? null : (
              <Link
                to="/g/$groupId/t/$trackId"
                params={{ groupId, trackId }}
                className={buttonClasses("secondary", "sm")}
              >
                Back to track
              </Link>
            )}
          </div>
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
          <MarkCompleteButton completion={completion} demoteToSecondary={markCompleteDemoted} />
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
            variant={forwardIsPrimary ? "primary" : "secondary"}
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
 * Activity-level completion closure for `manual_mark`. Incomplete: a callout
 * carrying the primary "Mark activity complete" CTA — the single action that
 * closes a manual-mark record (per-Part marks never auto-complete it). Complete:
 * a "good"-tone confirmation so the participant gets the dialog-closure signal
 * the per-Part marks alone never provided (Shneiderman rule 4). The button stays
 * ENABLED while pending (a disabled focused button drops focus to `<body>`);
 * `aria-busy` announces the in-flight state and the handler short-circuits a
 * re-entrant click.
 */
function ActivityCompletionBanner({
  activityCompletion,
  ctaIsPrimary,
}: {
  readonly activityCompletion: ActivityCompletion;
  readonly ctaIsPrimary: boolean;
}) {
  const { completed, pending, onComplete } = activityCompletion;
  if (completed) {
    return (
      <Callout tone="good" className="py-2">
        <span className="inline-flex items-center gap-1.5">
          <Check size={14} strokeWidth={1.75} aria-hidden="true" />
          Activity complete — your progress is recorded.
        </span>
      </Callout>
    );
  }
  return (
    <Callout tone="neutral" className="py-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>When you're done, mark this activity complete to record it.</span>
        <Button
          type="button"
          variant={ctaIsPrimary ? "primary" : "secondary"}
          size="sm"
          onClick={() => {
            if (!pending) onComplete();
          }}
          aria-busy={pending}
        >
          <Check size={14} strokeWidth={1.75} aria-hidden="true" />
          Mark activity complete
        </Button>
      </div>
    </Callout>
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
 * `demoteToSecondary` forces the button to render secondary whenever the
 * forward affordance (Next / Back to track) owns the footer's single primary
 * slot — once the Part is complete; otherwise the incomplete Mark-complete is
 * the footer's primary call to action.
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
