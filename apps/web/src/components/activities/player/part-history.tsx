import type { PartHistory } from "@hearth/domain";
import { History } from "lucide-react";
import { useState } from "react";
import { usePartHistory } from "../../../hooks/use-activity-record.ts";
import { formatShortDate } from "../../../lib/format.ts";

const REASON_LABEL: Record<PartHistory["reason"], string> = {
  retry: "You redid this part",
  revision_bump: "A newer revision reopened this part",
  facilitator_reset: "A facilitator reset your progress",
};

/**
 * Disclosure for a Part's preserved earlier work. The chip is shown only when
 * the record reports prior history for this Part; expanding it fetches the
 * snapshots lazily (one request, on first open). Hearth never overwrites work
 * silently — a retry, a revision bump, or a facilitator reset always lands the
 * superseded state here, and this is where the participant can see it.
 */
export function PartHistoryDisclosure({
  recordId,
  partId,
}: {
  readonly recordId: string | null;
  readonly partId: string;
}) {
  const [open, setOpen] = useState(false);
  const history = usePartHistory(recordId, partId, open);

  return (
    <div className="max-w-2xl text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-[var(--color-ink-2)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        <History size={12} strokeWidth={1.75} aria-hidden="true" />
        {open ? "Hide earlier attempts" : "Earlier attempts preserved"}
      </button>
      {open ? (
        <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--color-rule)] p-3">
          {history.isLoading ? (
            <p className="text-[var(--color-ink-3)]">Loading earlier attempts…</p>
          ) : history.isError ? (
            <div className="flex items-center gap-2 text-[var(--color-ink-2)]">
              <span>Couldn't load earlier attempts.</span>
              <button
                type="button"
                onClick={() => void history.refetch()}
                className="underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          ) : (history.data?.length ?? 0) === 0 ? (
            <p className="text-[var(--color-ink-3)]">No earlier attempts.</p>
          ) : (
            <ul className="space-y-2">
              {history.data?.map((entry) => (
                <li key={entry.id} className="space-y-0.5">
                  <div className="text-[var(--color-ink-1)]">{REASON_LABEL[entry.reason]}</div>
                  <div className="text-[11px] text-[var(--color-ink-3)]">
                    {formatShortDate(new Date(entry.recordedAt))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
