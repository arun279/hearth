import type { ActivityPart } from "@hearth/domain";
import { cn, PartIcon, partKindLabel } from "@hearth/ui";

type Props = {
  readonly parts: readonly ActivityPart[];
  readonly orderedPartIds: readonly string[];
  readonly activePartId: string;
  readonly onSelectPart: (partId: string) => void;
};

/**
 * Mobile-only horizontal scroller of Part pills. Sticky-top so the
 * active Part stays visible as the body scrolls; the pill row is
 * always at hand. Matches the prototype mobile-dark layout where the
 * Parts strip sits just below the title and above the body.
 *
 * Scrolls horizontally on overflow; the active pill is `scrollIntoView`-d
 * by the parent when the active id changes, but the affordance for
 * direct-touch reordering stays the user's tap or swipe — no
 * auto-advance.
 */
export function PartTabBar({ parts, orderedPartIds, activePartId, onSelectPart }: Props) {
  const partById = new Map(parts.map((p) => [p.id, p]));
  return (
    <nav
      aria-label="Activity Parts"
      className="sticky top-0 z-10 flex shrink-0 overflow-x-auto border-[var(--color-rule)] border-b bg-[var(--color-surface)] md:hidden"
    >
      <ol className="flex w-max gap-1 px-3 py-2">
        {orderedPartIds.map((partId, index) => {
          const part = partById.get(partId);
          if (!part) return null;
          const isActive = partId === activePartId;
          return (
            <li key={partId}>
              <button
                type="button"
                onClick={() => onSelectPart(partId)}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[12px] transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
                  isActive
                    ? "border-[var(--color-accent-border)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                    : "border-[var(--color-rule)] bg-[var(--color-bg)] text-[var(--color-ink-2)]",
                )}
                aria-current={isActive ? "step" : undefined}
              >
                <PartIcon kind={part.kind} size={11} />
                <span>
                  {index + 1}. {partTitle(part) ?? partKindLabel(part.kind)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function partTitle(part: ActivityPart): string | null {
  if ("title" in part && typeof part.title === "string") return part.title;
  return null;
}
