import type { ActivityPart } from "@hearth/domain";
import { cn, PartIcon } from "@hearth/ui";
import { Check } from "lucide-react";
import { partTitle } from "./_lib/part-title.ts";

type Props = {
  readonly parts: readonly ActivityPart[];
  readonly orderedPartIds: readonly string[];
  readonly activePartId: string;
  readonly completedPartIds: ReadonlySet<string>;
  readonly onSelectPart: (partId: string) => void;
};

/**
 * Desktop-only 240px column of Part-buttons. Each row shows a status
 * indicator, the Part's icon, and its label. The active Part gets a left
 * accent border + bolder ink — a single, restrained signal that
 * doesn't compete with the title strip above.
 *
 * Label format mirrors the mobile PartTabBar via the shared `partTitle`
 * helper, so the accessible name and visual ordering match across the two
 * surfaces. The completed-Part signal is a check glyph plus a "(completed)"
 * suffix on the accessible name — conveyed by icon + text, never colour
 * alone (WCAG 1.4.1). A completed inactive row also drops to muted ink so it
 * reads as done at a glance for sighted users, pairing the redundant cue with
 * the check rather than relying on it alone.
 */
export function FlowSidebar({
  parts,
  orderedPartIds,
  activePartId,
  completedPartIds,
  onSelectPart,
}: Props) {
  const partById = new Map(parts.map((p) => [p.id, p]));
  return (
    <nav
      aria-label="Activity Parts"
      className="hidden w-[240px] shrink-0 border-[var(--color-rule)] border-r bg-[var(--color-surface)] md:flex md:flex-col"
    >
      <ol className="flex flex-col gap-0.5 px-2.5 py-4">
        {orderedPartIds.map((partId, index) => {
          const part = partById.get(partId);
          if (!part) return null;
          const isActive = partId === activePartId;
          const isComplete = completedPartIds.has(partId);
          return (
            <li key={partId}>
              <button
                type="button"
                onClick={() => onSelectPart(partId)}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors",
                  "hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
                  isActive
                    ? "border-[var(--color-accent)] border-l-2 bg-[var(--color-accent-soft)] pl-[6px] text-[var(--color-ink)]"
                    : isComplete
                      ? "border-transparent border-l-2 bg-[var(--color-surface-2)] text-[var(--color-ink-2)]"
                      : "border-transparent border-l-2 text-[var(--color-ink-2)]",
                )}
                aria-current={isActive ? "step" : undefined}
              >
                <PartStatusDot complete={isComplete} />
                <PartIcon kind={part.kind} size={13} />
                <div className="min-w-0 flex-1 truncate text-[12px]">
                  {partTitle(part, index)}
                  {isComplete ? <span className="sr-only"> (completed)</span> : null}
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Per-Part status indicator. A completed Part shows a check glyph in the
 * accent tone; an incomplete one shows a neutral dot. Both reserve the same
 * box so a status flip doesn't shift the row. The accessible "(completed)"
 * label lives on the row text, so this glyph stays `aria-hidden`.
 */
function PartStatusDot({ complete }: { readonly complete: boolean }) {
  if (complete) {
    return (
      <span className="inline-flex size-3.5 shrink-0 items-center justify-center text-[var(--color-accent)]">
        <Check size={12} strokeWidth={2.25} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="inline-flex size-3.5 shrink-0 items-center justify-center" aria-hidden="true">
      <span className="inline-block size-1.5 rounded-full bg-[var(--color-rule)]" />
    </span>
  );
}
