import type { PeerProgressVisibility, TrackProgressRow } from "@hearth/domain";
import { Avatar, Badge, Button, Callout, EmptyState, Skeleton } from "@hearth/ui";
import { type ActivityListItem, useTrackActivities } from "../../hooks/use-activities.ts";
import { useMeContext } from "../../hooks/use-me-context.ts";
import { useTrackProgress } from "../../hooks/use-tracks.ts";
import { asUserMessage, errorStatus } from "../../lib/problem.ts";
import { ProgressDot, type ProgressState } from "./progress-dot.tsx";

type Props = {
  readonly trackId: string;
  readonly peerProgressVisibility: PeerProgressVisibility;
};

type ParticipantProgress = {
  readonly participantId: string;
  readonly displayName: string;
  readonly byActivity: Map<string, TrackProgressRow>;
  readonly priorAttempts: number | null;
};

/**
 * The track-altitude progress roster — "who is where on this track." One row
 * per participant who has started an activity, each carrying a coarse cell per
 * track activity (in the track's activity order, NOT a ranking of people).
 * Rows are alphabetical by display name so the surface can never read as a
 * leaderboard. A facilitator additionally sees each participant's preserved
 * prior-attempt count (the struggle signal); a peer on a `facilitator_only`
 * track sees only their own row.
 */
export function TrackProgressTab({ trackId, peerProgressVisibility }: Props) {
  const me = useMeContext();
  const myUserId = me.data?.data.user?.id ?? null;
  const progress = useTrackProgress(trackId, true);
  const activitiesQuery = useTrackActivities(trackId, true);

  if (progress.isLoading || activitiesQuery.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (progress.isError) {
    const status = errorStatus(progress.error);
    // 404 (not a member of the parent group) / 403 (in the group but not a
    // participant or authority) are permanent for this viewer — a retry can't
    // recover either, so a neutral "not available" surface stands in rather
    // than a danger Callout that reads as an outage.
    if (status === 404 || status === 403) {
      return (
        <Callout tone="neutral" title="Progress isn't available">
          <p>Enroll on this track to see where everyone is.</p>
        </Callout>
      );
    }
    return (
      <Callout tone="danger" title="Couldn't load progress">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {asUserMessage(
              progress.error,
              "The progress roster didn't return — check your connection and try again.",
            )}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void progress.refetch()}>
            Try again
          </Button>
        </div>
      </Callout>
    );
  }

  if (activitiesQuery.isError) {
    return (
      <Callout tone="danger" title="Couldn't load activities">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {asUserMessage(
              activitiesQuery.error,
              "The activity list didn't return — the roster needs it to lay out progress. Try again.",
            )}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void activitiesQuery.refetch()}>
            Try again
          </Button>
        </div>
      </Callout>
    );
  }

  const entries = progress.data ?? [];
  const activities = activitiesQuery.data ?? [];
  const isFacilitatorView = entries.some((e) => e.retryCount !== null);
  const peerLimited = peerProgressVisibility === "facilitator_only" && !isFacilitatorView;

  if (entries.length === 0) {
    return (
      <EmptyState
        title="No progress yet"
        description={
          peerLimited
            ? "On this track, only facilitators see everyone's progress. Your own completed activities will appear here once you start."
            : "Participants appear here once they start an activity. Progress shows completion only — never anyone's responses."
        }
      />
    );
  }

  const participants = groupByParticipant(entries, isFacilitatorView);

  return (
    <div className="space-y-3">
      <p className="text-[0.75rem] text-[var(--color-ink-2)]">
        {peerLimited
          ? "Only facilitators see everyone's progress on this track. You can see your own below."
          : "Where everyone is across this track. Each dot is an activity in track order — a green check is complete, a ring is in progress, an outline is not started yet."}
      </p>

      <ul
        aria-label="Track progress by participant"
        className="divide-y divide-[var(--color-rule)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)]"
      >
        {participants.map((p) => (
          <ParticipantRow
            key={p.participantId}
            participant={p}
            activities={activities}
            isMe={p.participantId === myUserId}
          />
        ))}
      </ul>
    </div>
  );
}

function ParticipantRow({
  participant,
  activities,
  isMe,
}: {
  readonly participant: ParticipantProgress;
  readonly activities: readonly ActivityListItem[];
  readonly isMe: boolean;
}) {
  return (
    <li className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2">
        <Avatar name={participant.displayName} size={24} />
        <span className="truncate font-medium text-[0.8125rem] text-[var(--color-ink)]">
          {participant.displayName}
        </span>
        {isMe ? <Badge tone="accent">You</Badge> : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex flex-wrap items-center gap-1">
          {activities.map((activity) => {
            const state: ProgressState =
              participant.byActivity.get(activity.id)?.completionState ?? "not_started";
            return (
              <ProgressDot
                key={activity.id}
                state={state}
                label={`${activity.title}: ${labelFor(state)}`}
              />
            );
          })}
        </div>
        {participant.priorAttempts !== null && participant.priorAttempts > 0 ? (
          <span className="text-[0.6875rem] text-[var(--color-ink-3)]">
            {participant.priorAttempts} prior{" "}
            {participant.priorAttempts === 1 ? "attempt" : "attempts"}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function labelFor(state: ProgressState): string {
  return state === "completed"
    ? "completed"
    : state === "in_progress"
      ? "in progress"
      : "not started";
}

function groupByParticipant(
  entries: readonly TrackProgressRow[],
  isFacilitatorView: boolean,
): readonly ParticipantProgress[] {
  const map = new Map<
    string,
    { displayName: string; byActivity: Map<string, TrackProgressRow>; priorAttempts: number }
  >();
  for (const entry of entries) {
    let row = map.get(entry.participantId);
    if (!row) {
      row = { displayName: entry.participantDisplayName, byActivity: new Map(), priorAttempts: 0 };
      map.set(entry.participantId, row);
    }
    row.byActivity.set(entry.activityId, entry);
    row.priorAttempts += entry.retryCount ?? 0;
  }
  return [...map.entries()]
    .map(([participantId, row]) => ({
      participantId,
      displayName: row.displayName,
      byActivity: row.byActivity,
      priorAttempts: isFacilitatorView ? row.priorAttempts : null,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
