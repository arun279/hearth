import {
  DomainError,
  type LearningTrackId,
  projectTrackProgressRow,
  type TrackProgressRow,
  type UserId,
} from "@hearth/domain";
import { isAuthorityOverTrack } from "@hearth/domain/policy/is-authority-over-track";
import type { ActivityRecordRepository } from "@hearth/ports";
import { type LoadViewableTrackDeps, loadViewableTrack } from "./_lib/load-viewable-track.ts";
import { memberDisplayName } from "./_lib/member-display-name.ts";

export type ListTrackProgressInput = {
  readonly actor: UserId;
  readonly trackId: LearningTrackId;
};

export type ListTrackProgressDeps = LoadViewableTrackDeps & {
  readonly records: ActivityRecordRepository;
};

export type ListTrackProgressResult = {
  readonly entries: readonly TrackProgressRow[];
};

/**
 * The track-altitude progress roster: every participant's coarse completion
 * fact across the track's activities. Two-factor gated —
 *
 *   1. `loadViewableTrack` 404s a non-member before anything else, so the
 *      track id is not an enumeration oracle (viewability before authorization).
 *   2. A non-authority viewer must hold an active enrollment; a group member
 *      who can see the track but isn't a participant gets 403.
 *
 * What the gated viewer receives is shaped by `track.peerProgressVisibility`:
 *   - a Track authority (Facilitator / Group Admin) always sees every row,
 *     each carrying the facilitator-only `retryCount` struggle signal;
 *   - on a `shared` track, a peer sees every enrollee's coarse row (no
 *     `retryCount`);
 *   - on a `facilitator_only` track, a peer sees only their own row.
 *
 * STANDING INVARIANT — the roster stays coarse + non-ranked and is never a
 * social feed. Surface only non-ranked completion facts (`completionState` +
 * `completedAt`), at most a non-ordered "N of M completed" headline: no
 * leaderboard, ranking, ordering ("who's ahead"), streaks, or reactions, here
 * or on the per-activity completion chips. Peer awareness must never become
 * peer comparison (the Participation-Mode design lists "social feed" as an
 * explicit Avoid). `retryCount` / part-history is a facilitator-only struggle
 * signal, never peer-exposed, independent of `peerProgressVisibility`. The
 * roster shows only participants who have a record (started at least one
 * activity) — a peer-facing "who hasn't started" column is surveillance, not
 * awareness, so this query joins no enrollment rows. A facilitator-only
 * non-starter view for pacing is a separate, deferred design (not yet built):
 * if it ships it must stay facilitator-scoped and framed as pacing, not
 * chasing. Any ranking/ordering/streak/reaction or non-starter exposure is a
 * design decision to relitigate against the Participation-Mode constraint
 * first, not a routine roster enhancement.
 */
export async function listTrackProgress(
  input: ListTrackProgressInput,
  deps: ListTrackProgressDeps,
): Promise<ListTrackProgressResult> {
  const { actor, group, track, groupMembership, trackEnrollment } = await loadViewableTrack(
    input.actor,
    input.trackId,
    deps,
  );

  const isAuthority = isAuthorityOverTrack(track, groupMembership, trackEnrollment);
  const isActiveEnrollee = trackEnrollment !== null && trackEnrollment.leftAt === null;
  if (!isAuthority && !isActiveEnrollee) {
    throw new DomainError(
      "FORBIDDEN",
      "Only a track participant or authority may view progress.",
      "not_track_enrollee",
    );
  }

  const all = await deps.records.listByTrack(input.trackId);
  const records =
    isAuthority || track.peerProgressVisibility === "shared"
      ? all
      : all.filter((r) => r.participantId === actor.id);

  // Resolve each distinct participant's display name once (the M3 chain) and,
  // for an authority viewer only, the per-record retry count. A peer never
  // learns another participant's retry pressure, so `retryCount` stays null.
  const participantIds = [...new Set(records.map((r) => r.participantId))];
  const names = new Map<UserId, string>(
    await Promise.all(
      participantIds.map(async (id): Promise<[UserId, string]> => {
        const [user, membership] = await Promise.all([
          deps.users.byId(id),
          deps.groups.membership(group.id, id),
        ]);
        return [id, memberDisplayName(user, membership)];
      }),
    ),
  );

  const retryCounts = isAuthority
    ? new Map<string, number>(
        await Promise.all(
          records.map(
            async (r): Promise<[string, number]> => [
              r.id,
              await deps.records.countPartHistory(r.id),
            ],
          ),
        ),
      )
    : null;

  const entries = records.map((record) =>
    projectTrackProgressRow({
      record,
      participantDisplayName: names.get(record.participantId) ?? "Member",
      retryCount: retryCounts?.get(record.id) ?? null,
    }),
  );

  return { entries };
}
