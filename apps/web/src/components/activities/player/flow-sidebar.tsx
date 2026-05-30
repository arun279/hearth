import type { ActivityPart } from "@hearth/domain";
import { cn, PartIcon } from "@hearth/ui";
import { Check, Lock } from "lucide-react";
import { partTitle } from "./_lib/part-title.ts";

type Props = {
  readonly parts: readonly ActivityPart[];
  readonly orderedPartIds: readonly string[];
  readonly activePartId: string;
  readonly completedPartIds: ReadonlySet<string>;
  readonly lockedPartIds: ReadonlySet<string>;
  readonly onSelectPart: (partId: string) => void;
};

/**
 * Desktop-only 240px column of Part-buttons. Each row shows a status indicator
 * (completed check or neutral dot), the Part's icon, and its label, plus a lock
 * glyph when a hard prerequisite is still unmet. The active Part gets a left
 * accent border + bolder ink — a single, restrained signal that doesn't compete
 * with the title strip above.
 *
 * Locked Parts stay navigable: the participant can open one to read it, they
 * just can't mark it done until its prerequisite lands. Label format mirrors the
 * mobile PartTabBar via the shared `partTitle` helper so the accessible name and
 * visual ordering match across the two surfaces.
 */
export function FlowSidebar({
  parts,
  orderedPartIds,
  activePartId,
  completedPartIds,
  lockedPartIds,
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
          const isLocked = lockedPartIds.has(partId);
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
                    : cn(
                        "border-transparent border-l-2",
                        isLocked ? "text-[var(--color-ink-3)]" : "text-[var(--color-ink-2)]",
                      ),
                )}
                aria-current={isActive ? "step" : undefined}
              >
                <PartStatusDot complete={isComplete} />
                <PartIcon kind={part.kind} size={13} />
                <div className="min-w-0 flex-1 truncate text-[12px]">{partTitle(part, index)}</div>
                {isLocked ? (
                  <Lock
                    size={11}
                    strokeWidth={1.75}
                    className="shrink-0 text-[var(--color-ink-3)]"
                    aria-label="Locked until earlier parts are complete"
                  />
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Per-Part status indicator in a fixed-width slot so a completion flip never
 * shifts the row: a green check once the Part is done, a neutral dot until then.
 */
function PartStatusDot({ complete }: { readonly complete: boolean }) {
  return (
    <span className="flex w-[14px] shrink-0 justify-center" aria-hidden="true">
      {complete ? (
        <Check size={13} strokeWidth={2} className="text-[var(--color-good)]" />
      ) : (
        <span className="inline-block size-1.5 rounded-full bg-[var(--color-rule)]" />
      )}
    </span>
  );
}
