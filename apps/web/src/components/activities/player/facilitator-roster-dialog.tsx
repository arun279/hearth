import { Badge, Button, Callout, Modal } from "@hearth/ui";
import { useState } from "react";
import { toast } from "sonner";
import {
  type ActivityParticipantRow,
  useActivityParticipants,
  useResetParticipant,
} from "../../../hooks/use-activity-record.ts";
import { asUserMessage, errorStatus } from "../../../lib/problem.ts";
import { ConfirmActionDialog } from "../../admin/confirm-action-dialog.tsx";

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly activityId: string;
  readonly activityTitle: string;
};

/**
 * Facilitator-only participant roster for one activity, and the entry point to
 * the reset affordance. Gated by the caller on the viewer being a Track
 * Facilitator (the player's `viewer.enrollmentStatus`); the roster route itself
 * 404s a non-viewer and 403s an authorized non-facilitator, so a row is never
 * shown to someone who couldn't act on it.
 *
 * Reset is destructive in a non-obvious way — the participant keeps their work
 * as Part History but loses current progress — so it routes through the shared
 * <ConfirmActionDialog> with copy that names the preservation. On success the
 * row's prior-attempt count and completion state update in place from the
 * returned full view (no refetch).
 */
export function FacilitatorRosterDialog({ open, onClose, activityId, activityTitle }: Props) {
  const query = useActivityParticipants(activityId, open);
  const reset = useResetParticipant(activityId);
  const [confirming, setConfirming] = useState<ActivityParticipantRow | null>(null);

  const close = () => {
    if (reset.isPending) return;
    onClose();
  };

  const entries = query.data?.entries ?? [];

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        title={`${activityTitle} — participants`}
        description="Reset a participant's progress for this activity. Their work is preserved as Part History."
        size="lg"
        footer={
          <Button variant="secondary" onClick={close} disabled={reset.isPending}>
            Close
          </Button>
        }
      >
        {query.isLoading ? (
          <p className="text-[0.8125rem] text-[var(--color-ink-2)]">Loading participants…</p>
        ) : query.isError ? (
          <RosterError query={query} />
        ) : entries.length === 0 ? (
          <p className="text-[0.8125rem] text-[var(--color-ink-2)]">
            No participants have started this activity yet.
          </p>
        ) : (
          <ul
            aria-label="Activity participants"
            className="divide-y divide-[var(--color-rule)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-rule)]"
          >
            {entries.map((row) => (
              <li
                key={row.participantId}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate font-medium text-[0.8125rem] text-[var(--color-ink)]">
                    {row.displayName}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={row.completionState === "completed" ? "good" : "neutral"}>
                      {row.completionState === "completed" ? "Completed" : "In progress"}
                    </Badge>
                    {row.partHistoryCount > 0 ? (
                      <span className="text-[0.6875rem] text-[var(--color-ink-3)]">
                        {row.partHistoryCount} prior{" "}
                        {row.partHistoryCount === 1 ? "attempt" : "attempts"} preserved
                      </span>
                    ) : null}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => setConfirming(row)}
                  disabled={reset.isPending}
                >
                  Reset progress
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <ConfirmActionDialog
        open={confirming !== null}
        tone="destructive"
        title="Reset this participant's progress?"
        description={
          confirming !== null ? (
            <>
              Reset progress for <strong>{confirming.displayName}</strong>? Their work is preserved
              as Part History — they keep every prior attempt, but their current progress on this
              activity is cleared.
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Reset progress"
        pending={reset.isPending}
        errorMessage={
          reset.isError ? asUserMessage(reset.error, "Couldn't reset progress.") : undefined
        }
        onClose={() => {
          if (!reset.isPending) setConfirming(null);
        }}
        onConfirm={async () => {
          if (confirming === null) return;
          try {
            await reset.mutateAsync(confirming.participantId);
            toast.success(`Reset progress for ${confirming.displayName}.`);
            setConfirming(null);
          } catch (err) {
            toast.error(asUserMessage(err, "Couldn't reset progress."));
          }
        }}
      />
    </>
  );
}

function RosterError({ query }: { readonly query: ReturnType<typeof useActivityParticipants> }) {
  const status = errorStatus(query.error);
  // 404 (not a viewer of the parent group) / 403 (authorized non-facilitator)
  // are permanent for this viewer — retry can't recover either, so a neutral
  // "not available" surface stands in. Any other failure is transient and keeps
  // the danger Callout + retry.
  if (status === 404 || status === 403) {
    return (
      <Callout tone="neutral" title="Participants aren't available">
        <p>You don't have facilitator access to this activity's participant records.</p>
      </Callout>
    );
  }
  return (
    <Callout tone="danger" title="Couldn't load participants">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>
          {asUserMessage(
            query.error,
            "We couldn't load the participant roster — check your connection and try again.",
          )}
        </span>
        <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    </Callout>
  );
}
