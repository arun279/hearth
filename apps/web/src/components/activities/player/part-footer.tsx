import { Button, buttonClasses } from "@hearth/ui";
import { Link } from "@tanstack/react-router";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  readonly previousPartId: string | null;
  readonly nextPartId: string | null;
  readonly onNavigate: (partId: string) => void;
  readonly groupId: string;
  readonly trackId: string;
};

const MARK_COMPLETE_HINT_ID = "mark-complete-placeholder-hint";

/**
 * Sticky footer for the Activity Player.
 *
 * Mid-flow (any Part with a next), the footer signposts the deferred
 * completion model: a non-interactive "Mark complete" placeholder
 * (`aria-disabled`, no handler) sits between a live Previous and a live
 * Next. Completion isn't wired yet — keeping the placeholder mid-flow lets
 * a later milestone light up an existing control rather than rebuild it.
 *
 * On the LAST (or only) Part there is no next Part and completion can't be
 * marked yet, so a disabled Next plus a dead placeholder would strand the
 * participant with no live forward action (and a focusable-but-inert tab
 * stop). Instead the footer collapses to a single live "Back to track"
 * link — the honest closure action: it navigates, it does NOT claim
 * completion (which isn't persisted until a later milestone). The label
 * matches the header's back link verbatim so the same destination reads
 * consistently in both places.
 */
export function PartFooter({ previousPartId, nextPartId, onNavigate, groupId, trackId }: Props) {
  const isLastPart = nextPartId === null;
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
      {isLastPart ? (
        // TODO(part-footer): once @hearth/ui Button supports an `asChild`
        // slot, collapse this hand-styled Link to <Button asChild><Link/></Button>.
        <Link
          to="/g/$groupId/t/$trackId"
          params={{ groupId, trackId }}
          className={buttonClasses("primary", "sm")}
        >
          <ChevronLeft size={14} strokeWidth={1.5} aria-hidden="true" />
          Back to track
        </Link>
      ) : (
        <>
          <button
            type="button"
            aria-disabled="true"
            aria-describedby={MARK_COMPLETE_HINT_ID}
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
            size="sm"
          >
            Next
            <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
          </Button>
        </>
      )}
    </footer>
  );
}
