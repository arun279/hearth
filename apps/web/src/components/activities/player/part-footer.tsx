import { Button, buttonClasses, Callout, cn } from "@hearth/ui";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Flag, Square, SquareCheck } from "lucide-react";
import type { PartMeasure } from "./_lib/part-measure.ts";

/**
 * `canMark` is false for a read-only viewer or a closed window; the control is
 * then hidden entirely rather than shown disabled, so no dead focusable tab
 * stop is left behind.
 */
type Completion = {
  readonly completed: boolean;
  readonly canMark: boolean;
  readonly pending: boolean;
  readonly onToggle: () => void;
};

/**
 * The activity-level completion affordance for the `manual_mark` Completion
 * Rule. Absent (`null`) for `all_parts_complete` (the server auto-completes on
 * the last Part) and for read-only / non-author viewers.
 */
type ActivityCompletion = {
  readonly completed: boolean;
  readonly pending: boolean;
  readonly onComplete: () => void;
};

type Props = {
  /**
   * The active Part's content measure. The footer shares the header's and
   * body's measure so the three columns share a width and left edge across
   * every Part kind.
   */
  readonly measure: PartMeasure;
  readonly previousPartId: string | null;
  readonly nextPartId: string | null;
  readonly onNavigate: (partId: string) => void;
  readonly groupId: string;
  readonly trackId: string;
  readonly completion: Completion | null;
  /**
   * True once every Part carries the participant's completion mark, under the
   * `all_parts_complete` rule. Scoped to per-Part marking — it never claims the
   * activity itself is complete (that is `activityCompletion`'s job).
   */
  readonly allPartsComplete: boolean;
  readonly activityCompletion: ActivityCompletion | null;
  /**
   * True when the active Part's body renders its own filled-primary action (a
   * Quiz "Submit"). See the single-primary arbitration note on `PartFooter`.
   */
  readonly bodyOwnsPrimary: boolean;
};

/**
 * Sticky footer for the Activity Player, stacked granular-work-first so the
 * terminal close action sits last: the all-parts-complete note, the per-Part
 * "Mark this part done" toggle, the activity-close banner, then Previous/Next.
 * The per-Part toggle and the close banner each ride a Callout so they read as
 * one coherent stack rather than orphaned bare buttons.
 *
 * Completion is honor-system: the per-Part toggle is always enabled regardless
 * of a reflection's `minWords` or a quiz's score, and a done Part flips to a
 * reversible "Part done" state.
 *
 * Single-primary arbitration is a WHOLE-SURFACE guarantee, not footer-local.
 * Exactly one filled-primary shows across the body + footer, resolved in
 * priority order:
 *   1. `bodyOwnsPrimary` (a Quiz "Submit") — the footer cedes the slot entirely
 *      and every footer control stays secondary;
 *   2. otherwise on the last Part, the incomplete activity-close CTA
 *      (`activityCtaIsPrimary`) — last-Part position is the readiness signal;
 *   3. otherwise the incomplete, markable per-Part toggle;
 *   4. otherwise the forward affordance (Next, or "Back to track" on the last
 *      Part) once nothing here is left to mark.
 * The activity-close CTA stays an enabled secondary (never disabled) before the
 * last Part so it is always visible without out-shouting the in-flow actions.
 *
 * Previous/Next labels collapse to icon-only below `sm` (accessible name via
 * `aria-label`) and rows wrap so nothing overflows down to 320px.
 */
export function PartFooter({
  measure,
  previousPartId,
  nextPartId,
  onNavigate,
  groupId,
  trackId,
  completion,
  allPartsComplete,
  activityCompletion,
  bodyOwnsPrimary,
}: Props) {
  const isLastPart = nextPartId === null;
  const activePartComplete = completion?.completed ?? false;
  const activityCtaIsPrimary =
    !bodyOwnsPrimary && activityCompletion !== null && !activityCompletion.completed && isLastPart;
  const forwardIsPrimary =
    !bodyOwnsPrimary &&
    !activityCtaIsPrimary &&
    (activePartComplete || !(completion?.canMark ?? false));
  const finishIsPrimary = isLastPart && forwardIsPrimary;
  const markCompleteDemoted = bodyOwnsPrimary || forwardIsPrimary || activityCtaIsPrimary;
  return (
    <footer className="sticky bottom-0 z-10 shrink-0 border-[var(--color-rule)] border-t bg-[var(--color-surface)] px-5 py-3 md:px-8">
      <div className={cn("mx-auto flex w-full flex-col gap-2", measure)}>
        {allPartsComplete ? (
          // The in-banner "Back to track" link only shows mid-flow; on the last
          // Part the footer's own "Back to track" covers it, so showing both
          // would duplicate the link side by side.
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
        {completion?.canMark ? (
          <Callout tone="neutral" className="py-2">
            <MarkCompleteButton completion={completion} demoteToSecondary={markCompleteDemoted} />
          </Callout>
        ) : null}
        {activityCompletion ? (
          <ActivityCompletionBanner
            activityCompletion={activityCompletion}
            ctaIsPrimary={activityCtaIsPrimary}
          />
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
      </div>
    </footer>
  );
}

/**
 * Activity-level completion closure for `manual_mark`: the "Complete activity"
 * CTA is the single action that closes a manual-mark record (per-Part marks
 * never auto-complete it). Stays ENABLED while pending — a disabled focused
 * button drops focus to `<body>`, so `aria-busy` announces the in-flight state
 * and the handler short-circuits a re-entrant click instead (WCAG 2.4.7).
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
          <Flag size={14} strokeWidth={1.75} aria-hidden="true" />
          Activity complete — your progress is recorded.
        </span>
      </Callout>
    );
  }
  return (
    <Callout tone="neutral" className="py-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>When you're done, complete this activity to record it.</span>
        <Button
          type="button"
          variant={ctaIsPrimary ? "primary" : "secondary"}
          size="sm"
          onClick={() => {
            if (!pending) onComplete();
          }}
          aria-busy={pending}
        >
          <Flag size={14} strokeWidth={1.75} aria-hidden="true" />
          Complete activity
        </Button>
      </div>
    </Callout>
  );
}

/**
 * The honor-system per-Part toggle. Writes real per-Part record state under
 * every Completion Rule — the header progress bar, the sidebar/tab status dots,
 * and the facilitator roster all read it.
 *
 * A single stable `<button>` whose label, icon, `variant`, and `aria-pressed`
 * update in place (never remounted). Stays ENABLED while in flight — disabling a
 * focused button moves focus to `<body>`, so `aria-busy` announces the pending
 * state and the handler short-circuits a re-entrant click, keeping the focus
 * ring on the control (WCAG 2.4.7).
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
      {completed ? (
        <SquareCheck size={14} strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <Square size={14} strokeWidth={1.75} aria-hidden="true" />
      )}
      {completed ? "Part done" : "Mark this part done"}
    </Button>
  );
}
