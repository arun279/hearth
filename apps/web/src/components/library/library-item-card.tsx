import { Badge, cn } from "@hearth/ui";
import { ChevronRight } from "lucide-react";
import type { LibraryListEntry } from "../../hooks/use-library.ts";
import { formatBytes } from "../../lib/format.ts";
import { KindBadge } from "./kind-badge.tsx";

type Props = {
  readonly entry: LibraryListEntry;
  readonly onSelect: (itemId: string) => void;
};

/**
 * One row in the Library list. Calm, text-focused: kind tile + title +
 * one-line metadata (revision label, steward count, used-in count, size).
 * Tags collapse onto the metadata line at narrow widths instead of taking
 * a dedicated column — at 375px the four-column desktop grid would
 * truncate the title to nonsense.
 *
 * The whole row is one button so keyboard users tab once and Enter to
 * open the detail.
 */
export function LibraryItemCard({ entry, onSelect }: Props) {
  const { item, currentRevision, stewardCount, usedInCount } = entry;
  const revisionLabel = currentRevision !== null ? `r${currentRevision.revisionNumber}` : "—";
  const sizeLabel = currentRevision !== null ? formatBytes(currentRevision.sizeBytes) : null;
  const usedInPhrase =
    usedInCount === 0
      ? "not yet used"
      : usedInCount === 1
        ? "used in 1 activity"
        : `used in ${usedInCount} activities`;
  const stewardPhrase =
    stewardCount === 0 ? null : stewardCount === 1 ? "1 steward" : `${stewardCount} stewards`;
  const isRetired = item.retiredAt !== null;
  const hasTags = item.tags.length > 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      className={cn(
        "group grid w-full grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-left transition-colors",
        "hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg)]",
      )}
      aria-label={`Open ${item.title}`}
    >
      <KindBadge kind={entry.displayKind} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-[13px] text-[var(--color-ink)]">
            {item.title}
          </span>
          {isRetired ? <Badge tone="neutral">retired</Badge> : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--color-ink-3)]">
          <span className="font-mono">{revisionLabel}</span>
          {sizeLabel ? <span>· {sizeLabel}</span> : null}
          {stewardPhrase ? <span>· {stewardPhrase}</span> : null}
          <span>· {usedInPhrase}</span>
          {hasTags ? (
            <span className="hidden font-mono text-[var(--color-ink-3)] sm:inline">
              · {item.tags.slice(0, 3).join(" · ")}
            </span>
          ) : null}
        </div>
      </div>
      <ChevronRight
        size={14}
        strokeWidth={1.5}
        className="text-[var(--color-ink-3)] transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </button>
  );
}
