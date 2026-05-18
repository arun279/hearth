import type { ActivityPart } from "@hearth/domain";
import { cn, PartIcon, partKindLabel } from "@hearth/ui";

type Props = {
  readonly parts: readonly ActivityPart[];
  readonly orderedPartIds: readonly string[];
  readonly activePartId: string;
  readonly onSelectPart: (partId: string) => void;
};

/**
 * Desktop-only 240px column of Part-buttons. Each row shows a status
 * dot, the Part's icon, and its label. The active Part gets a left
 * accent border + bolder ink — a single, restrained signal that
 * doesn't compete with the title strip above.
 *
 * Status dot renders neutral in M9; M11 will color it (`in_progress` /
 * `complete`) when Part Progress lands. The dot's shape and position
 * are final today so M11 only re-styles the className.
 */
export function FlowSidebar({ parts, orderedPartIds, activePartId, onSelectPart }: Props) {
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
          return (
            <li key={partId}>
              <button
                type="button"
                onClick={() => onSelectPart(partId)}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors",
                  "hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
                  isActive
                    ? "border-l-2 border-[var(--color-accent)] bg-[var(--color-accent-soft)] pl-[6px] text-[var(--color-ink)]"
                    : "border-l-2 border-transparent text-[var(--color-ink-2)]",
                )}
                aria-current={isActive ? "step" : undefined}
              >
                <PartStatusDot />
                <PartIcon kind={part.kind} size={13} />
                <div className="min-w-0 flex-1 truncate text-[12px]">
                  {partTitle(part) ?? partKindLabel(part.kind)}
                </div>
                <span className="font-mono text-[10px] text-[var(--color-ink-2)] tabular-nums">
                  {index + 1}
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

/**
 * Per-Part status indicator. v1 renders neutral; M11 colors it from
 * `part_progress` (`in_progress` accent, `complete` good). The dot
 * always reserves space so a status flip doesn't shift the row.
 */
function PartStatusDot() {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-1.5 shrink-0 rounded-full bg-[var(--color-rule)]"
    />
  );
}
