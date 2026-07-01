import type { TrackProgressRow } from "@hearth/domain";
import { ProgressDot, progressStateLabel } from "../tracks/progress-dot.tsx";

// Cap the inline cells so a long roster never overflows a 375px row; the
// overflow folds into a "+N" count rather than wrapping into a second line of
// the activity row.
const MAX_CELLS = 8;

/**
 * Per-activity completion chip for the Activities tab — coarse cells (one per
 * participant who has a record for this activity) plus, for a facilitator
 * viewer only, the "N of M completed" count. A peer sees the cells
 * but no count: the facilitator-only count is signalled by the server leaving
 * `retryCount` non-null, so the viewer's role is read straight off the payload
 * rather than threaded through caps. Renders nothing when no one has a record
 * yet, so untouched activities stay uncluttered.
 */
export function ActivityCompletionChip({
  entries,
}: {
  readonly entries: readonly TrackProgressRow[];
}) {
  if (entries.length === 0) return null;

  // Alphabetical by display name — a stable, deterministic order.
  const rows = [...entries].sort((a, b) =>
    a.participantDisplayName.localeCompare(b.participantDisplayName),
  );
  const isFacilitatorView = rows.some((r) => r.retryCount !== null);
  const completed = rows.filter((r) => r.completionState === "completed").length;
  const shown = rows.slice(0, MAX_CELLS);
  const overflow = rows.length - shown.length;

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="inline-flex flex-wrap items-center gap-0.5">
        {shown.map((row) => (
          <ProgressDot
            key={row.recordId}
            state={row.completionState}
            label={`${row.participantDisplayName}: ${progressStateLabel(row.completionState)}`}
          />
        ))}
        {overflow > 0 ? (
          <span className="font-mono text-[0.625rem] text-[var(--color-ink-3)]">+{overflow}</span>
        ) : null}
      </span>
      {isFacilitatorView ? (
        <span className="font-mono text-[0.6875rem] text-[var(--color-ink-2)] tabular-nums">
          {completed} of {rows.length} completed
        </span>
      ) : null}
    </span>
  );
}
