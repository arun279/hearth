import { Button } from "@hearth/ui";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  readonly previousPartId: string | null;
  readonly nextPartId: string | null;
  readonly onNavigate: (partId: string) => void;
};

/**
 * Sticky footer with prev / next / Mark Complete. The Mark-Complete
 * affordance is intentionally NOT a real action yet — it renders
 * disabled with an explanatory `title` tooltip until per-Part progress
 * lands in the next milestone. Showing the affordance now (rather than
 * hiding it) keeps the layout final and signals to the participant
 * that completion is part of the model, not an absent feature.
 *
 * Prev / next operate on the canonical Part display order; the parent
 * passes `null` at the start / end so the chevrons collapse to
 * disabled buttons rather than wrap-around.
 */
export function PartFooter({ previousPartId, nextPartId, onNavigate }: Props) {
  return (
    <footer className="sticky bottom-0 z-10 flex items-center justify-between gap-2 border-[var(--color-rule)] border-t bg-[var(--color-surface)] px-4 py-3 md:px-8">
      <Button
        type="button"
        variant="secondary"
        onClick={() => previousPartId && onNavigate(previousPartId)}
        disabled={previousPartId === null}
        size="sm"
      >
        <ChevronLeft size={14} strokeWidth={1.5} aria-hidden="true" />
        Previous
      </Button>
      <button
        type="button"
        // Pre-Records placeholder. `aria-disabled` lets screen readers
        // hear "dimmed" instead of skipping over the button entirely so
        // a participant who reaches this footer understands the model
        // includes completion even though the action isn't wired yet.
        aria-disabled="true"
        tabIndex={-1}
        title="Marking parts complete arrives in the next milestone."
        className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface-2)] px-3 py-1.5 font-medium text-[12px] text-[var(--color-ink-2)] opacity-70"
      >
        <Check size={13} strokeWidth={1.75} aria-hidden="true" />
        Mark complete
      </button>
      <Button
        type="button"
        variant="primary"
        onClick={() => nextPartId && onNavigate(nextPartId)}
        disabled={nextPartId === null}
        size="sm"
      >
        Next
        <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
      </Button>
    </footer>
  );
}
