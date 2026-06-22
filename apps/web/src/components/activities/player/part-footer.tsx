import { Button, buttonClasses, Callout, cn } from "@hearth/ui";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Flag, Square, SquareCheck } from "lucide-react";
import type { PartMeasure } from "./_lib/part-measure.ts";

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
  /**
   * The active Part's content measure (`partMeasure(activePart)`). The footer
   * shares the header's and body's measure so the three columns are the same
   * width and share a left edge across every Part kind.
   */
  readonly measure: PartMeasure;
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
  /**
   * True when the active Part's body renders its own filled-primary action (a
   * Quiz's "Submit"). The footer's flip is footer-local: it guarantees one
   * primary among ITS controls but can't see the body. When the body owns a
   * primary, the footer cedes the slot entirely — every footer control stays
   * secondary — so the whole surface shows exactly one filled-primary (the
   * body Submit), and "Complete activity" / "Back to track" can't out-shout the
   * unsatisfied quiz submission (Nielsen #8, Rams #3; error prevention,
   * Shneiderman #5).
   */
  readonly bodyOwnsPrimary: boolean;
};

/**
 * Sticky footer for the Activity Player, stacked top-to-bottom in the active
 * Part's measure, granular-work-first so the terminal close action sits last
 * (SAP Fiori / wizard-checkout convention; Shneiderman rule 4 closure): the
 * all-parts-complete note, the per-Part "Mark this part done" toggle on its own
 * line, the activity-close banner, and finally the Previous/Next navigation row.
 * The per-Part toggle is a Part-scoped state action, so it sits with the Part
 * content it governs, above the activity-close banner and apart from the
 * navigation pair (NN/G Gestalt-Proximity: grouping a different-type action with
 * Previous/Next reads as one cluster and hurts both). The toggle rides in its
 * own neutral Callout so it reads as the same visual species as the banner
 * directly below it — a bare button there reads as orphaned / top-light against
 * the framed callout (NN/G consistency; Rams "aesthetic").
 *
 * Completion is honor-system: the toggle is always enabled regardless of a
 * reflection's `minWords` or a quiz's score — it stays live so the
 * participant decides when a Part is done. A done Part flips the button to a
 * "Part done" state that un-marks on click, so the action is reversible. "Back
 * to track" navigates without claiming completion; the two are separate
 * affordances.
 *
 * The Previous/Next labels collapse to icon-only below `sm` (their accessible
 * name stays via `aria-label`) and the rows wrap if they still can't fit, so
 * nothing overflows down to a 320px viewport. At most one filled-primary button
 * per state. The activity-close CTA goes filled-primary only on the last Part —
 * the position that signals the participant is plausibly ready to finish; before
 * then it stays an enabled SECONDARY (never disabled) so "Next" / "Mark this
 * part done" leads while content remains. So: on the last Part the incomplete
 * activity-close CTA is the single primary; mid-flow while the active Part is
 * still markable and incomplete the per-Part toggle is primary and the forward
 * affordance steps down; once the Part is done (or the viewer can't mark), the
 * forward affordance (Next, or "Back to track" on the last Part) takes primary.
 *
 * "One filled-primary" is a WHOLE-SURFACE guarantee, not footer-local: when the
 * active Part body owns its own primary (`bodyOwnsPrimary` — a Quiz "Submit"),
 * the footer cedes the slot and every footer control stays secondary, so the
 * body Submit is the lone blue CTA and out-ranks (never ties with) the close
 * action.
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
  // The activity-close CTA claims the footer's single primary slot only once the
  // participant is plausibly ready to finish — last-Part POSITION is the
  // readiness signal. On the last Part the incomplete CTA is the headline close
  // action and every per-Part/forward control steps down. Before then it renders
  // an enabled SECONDARY (the banner stays visible, never disabled), so the
  // per-Part hierarchy below leads while content remains. Once the activity is
  // complete (or there is no manual CTA), that hierarchy resumes regardless.
  // When the body owns the surface's primary, no footer control takes it.
  const activityCtaIsPrimary =
    !bodyOwnsPrimary && activityCompletion !== null && !activityCompletion.completed && isLastPart;
  // The forward affordance ("Back to track" on the last Part, "Next" otherwise)
  // claims primary emphasis only once there's nothing left to mark here — while
  // the active Part is still incomplete (and the viewer may mark it),
  // Mark-complete owns the single primary slot so the two never render
  // filled-blue at once (one primary per footer; visual-hierarchy rule). Once
  // the Part is complete, Mark-complete steps down and the forward action leads.
  // When the body owns the surface's primary, no footer control takes it.
  const forwardIsPrimary =
    !bodyOwnsPrimary &&
    !activityCtaIsPrimary &&
    (activePartComplete || !(completion?.canMark ?? false));
  const finishIsPrimary = isLastPart && forwardIsPrimary;
  // The per-Part toggle is the footer's primary only when nothing else claims
  // it; the body owning the surface primary demotes the toggle along with the
  // rest of the footer.
  const markCompleteDemoted = bodyOwnsPrimary || forwardIsPrimary || activityCtaIsPrimary;
  return (
    <footer className="sticky bottom-0 z-10 shrink-0 border-[var(--color-rule)] border-t bg-[var(--color-surface)] px-5 py-3 md:px-8">
      <div className={cn("mx-auto flex w-full flex-col gap-2", measure)}>
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
        {completion?.canMark ? (
          // The per-Part toggle rides in a neutral Callout matching the
          // activity-close banner's frame so the two read as one coherent stack
          // (a bare button here reads orphaned / top-light against the framed
          // banner below — NN/G consistency, Rams "aesthetic").
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
 * Activity-level completion closure for `manual_mark`. Incomplete: a callout
 * carrying the "Complete activity" CTA — the single action that closes a
 * manual-mark record (per-Part marks never auto-complete it). The CTA renders
 * filled-primary only on the last Part (`ctaIsPrimary`, the readiness signal);
 * before then it is an enabled SECONDARY in the same visible callout — never
 * disabled — so the per-Part / Next actions lead while content remains. A Flag
 * glyph marks it as the finalize action, distinct from the per-Part checkbox and
 * the read-only status checks. Complete: a "good"-tone confirmation so the
 * participant gets the dialog-closure signal the per-Part marks alone never
 * provided (Shneiderman rule 4). The button stays ENABLED while pending (a
 * disabled focused button drops focus to `<body>`); `aria-busy` announces the
 * in-flight state and the handler short-circuits a re-entrant click.
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
 * The honor-system per-Part toggle: "Mark this part done" → "Part done", with a
 * checkbox glyph (empty Square → SquareCheck) that reads as checking an item off
 * a list and stays distinct from the activity-close Flag and the read-only
 * status checks elsewhere. It writes real per-Part record state under every
 * Completion Rule — the header progress bar, the sidebar/tab status dots, and
 * the facilitator roster all read it — so it is part-scoped, not a closure.
 *
 * A single stable `<button>` whose label, icon, `variant`, and `aria-pressed`
 * all update in place — never conditionally remounted, no changing React key. It
 * stays ENABLED while the toggle is in flight: disabling a focused button moves
 * focus to `<body>`, so an in-flight `disabled` would drop the keyboard user
 * after Enter/Space. Instead `aria-busy` announces the pending state and the
 * handler short-circuits a re-entrant click, so focus and the focus ring stay on
 * the control (WCAG 2.4.7).
 *
 * `demoteToSecondary` forces the button to render secondary whenever the forward
 * affordance (Next / Back to track) or the last-Part activity-close CTA owns the
 * footer's single primary slot; otherwise the incomplete per-Part toggle is the
 * footer's primary call to action (including mid-flow, where the activity-close
 * CTA stays secondary).
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
