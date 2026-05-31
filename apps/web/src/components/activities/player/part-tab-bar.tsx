import type { ActivityPart } from "@hearth/domain";
import { cn, PartIcon } from "@hearth/ui";
import { Check } from "lucide-react";
import { useEffect, useRef } from "react";
import { partTitle } from "./_lib/part-title.ts";

type Props = {
  readonly parts: readonly ActivityPart[];
  readonly orderedPartIds: readonly string[];
  readonly activePartId: string;
  readonly completedPartIds: ReadonlySet<string>;
  readonly onSelectPart: (partId: string) => void;
};

/**
 * Mobile-only horizontal scroller of Part pills. Sticky-top so the
 * active Part stays visible as the body scrolls; the pill row is
 * always at hand. Matches the prototype mobile-dark layout where the
 * Parts strip sits just below the title and above the body.
 *
 * On overflow the row scrolls horizontally; when the active id changes
 * (from a footer Next / Previous tap, or a deep-link), the active
 * pill is brought into view with `scrollIntoView` so the user doesn't
 * lose orientation. Direct taps still drive the user's own intent —
 * no auto-advance.
 *
 * A completed inactive pill carries the check glyph plus a muted fill (the
 * redundant done cue mirrored from FlowSidebar; see its WHY for the WCAG
 * 1.4.1 rationale) and the "(completed)" sr-only suffix.
 */
export function PartTabBar({
  parts,
  orderedPartIds,
  activePartId,
  completedPartIds,
  onSelectPart,
}: Props) {
  const partById = new Map(parts.map((p) => [p.id, p]));
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const active = root.querySelector<HTMLElement>('[data-active-pill="true"]');
    if (active) {
      active.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    }
  }, [activePartId]);

  return (
    <nav
      aria-label="Activity Parts"
      className="sticky top-0 z-10 flex shrink-0 overflow-x-auto border-[var(--color-rule)] border-b bg-[var(--color-surface)] md:hidden"
    >
      <ol ref={listRef} className="flex w-max gap-1 px-3 py-2">
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
                data-active-pill={isActive || undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[12px] transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
                  isActive
                    ? "border-[var(--color-accent-border)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                    : isComplete
                      ? "border-[var(--color-rule)] bg-[var(--color-surface-2)] text-[var(--color-ink-2)]"
                      : "border-[var(--color-rule)] bg-[var(--color-bg)] text-[var(--color-ink-2)]",
                )}
                aria-current={isActive ? "step" : undefined}
              >
                {isComplete ? (
                  <Check
                    size={11}
                    strokeWidth={2.25}
                    aria-hidden="true"
                    className="text-[var(--color-accent)]"
                  />
                ) : (
                  <PartIcon kind={part.kind} size={11} />
                )}
                <span>
                  {partTitle(part, index)}
                  {isComplete ? <span className="sr-only"> (completed)</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
