import { Button } from "@hearth/ui";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  readonly previousPartId: string | null;
  readonly nextPartId: string | null;
  readonly onNavigate: (partId: string) => void;
};

const MARK_COMPLETE_HINT_ID = "mark-complete-placeholder-hint";

/**
 * Sticky footer with prev / next / Mark Complete. The Mark-Complete
 * affordance is intentionally NOT a real action yet — it renders as a
 * non-interactive placeholder (`aria-disabled` + no click handler) so
 * the layout stays final and signals to the participant that completion
 * is part of the model, even though the action isn't wired yet.
 *
 * Accessibility: the button stays in tab order so keyboard + screen-
 * reader users can land on it and hear `aria-describedby`'s visually-
 * hidden hint announce why it's dimmed. A native `title` attribute
 * works for hovering mouse users but is unreliable for screen readers,
 * so the `<span class="sr-only">` is the load-bearing copy.
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
        aria-disabled="true"
        aria-describedby={MARK_COMPLETE_HINT_ID}
        onClick={(e) => e.preventDefault()}
        className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface-2)] px-3 py-1.5 font-medium text-[12px] text-[var(--color-ink-2)] opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        <Check size={13} strokeWidth={1.75} aria-hidden="true" />
        Mark complete
      </button>
      <span id={MARK_COMPLETE_HINT_ID} className="sr-only">
        Marking parts complete arrives in a later milestone.
      </span>
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
