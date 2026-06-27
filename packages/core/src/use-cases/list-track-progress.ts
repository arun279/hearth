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
 * The row payload is coarse completion (`completionState` + `completedAt`);
 * `retryCount` (the count of preserved prior attempts) is attached only for an
 * authority viewer, independent of `peerProgressVisibility`. The query reads
 * Activity Records, so the roster currently lists participants who have started
 * at least one activity; enrolled participants with no record yet are not
 * included.
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
