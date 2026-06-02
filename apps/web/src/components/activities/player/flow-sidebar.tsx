import type { ActivityPart } from "@hearth/domain";
import { cn, PartIcon } from "@hearth/ui";
import { partTitle } from "./_lib/part-title.ts";

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
 * Label format mirrors the mobile PartTabBar via the shared
 * `partTitle` helper, so the accessible name and visual ordering match
 * across the two surfaces. Status dot renders neutral; coloured states
 * land with per-Part progress in a later milestone, but the shape and
 * position are final so that change is a pure className flip.
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
                    ? "border-[var(--color-accent)] border-l-2 bg-[var(--color-accent-soft)] pl-[6px] text-[var(--color-ink)]"
                    : "border-transparent border-l-2 text-[var(--color-ink-2)]",
                )}
                aria-current={isActive ? "step" : undefined}
              >
                <PartStatusDot />
                <PartIcon kind={part.kind} size={13} />
                <div className="min-w-0 flex-1 truncate text-[12px]">{partTitle(part, index)}</div>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Per-Part status indicator. v1 renders neutral; coloured states
 * (`in_progress`, `complete`) land with per-Part progress later. The
 * dot always reserves space so a status flip doesn't shift the row.
 */
function PartStatusDot() {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-1.5 shrink-0 rounded-full bg-[var(--color-rule)]"
    />
  );
}
