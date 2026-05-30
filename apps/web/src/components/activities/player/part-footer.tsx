import { Button } from "@hearth/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  readonly previousPartId: string | null;
  readonly nextPartId: string | null;
  readonly onNavigate: (partId: string) => void;
};

/**
 * Sticky footer carrying previous / next navigation across the canonical Part
 * display order. The parent passes `null` at the start / end so the chevrons
 * collapse to disabled buttons rather than wrapping around. Marking a Part done
 * happens inline with that Part's content, where the work is.
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
