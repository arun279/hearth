import type { LearningTrack, LearningTrackId, TrackEnrollment, UserId } from "@hearth/domain";
import { canAssignTrackFacilitator } from "@hearth/domain/policy/can-assign-track-facilitator";
import { canRemoveTrackEnrollment } from "@hearth/domain/policy/can-remove-track-enrollment";
import { canRemoveTrackFacilitator } from "@hearth/domain/policy/can-remove-track-facilitator";
import { isAuthorityOverTrack } from "@hearth/domain/policy/is-authority-over-track";
import type {
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableTrack } from "./_lib/load-viewable-track.ts";

export type ListTrackPeopleInput = {
  readonly actor: UserId;
  readonly trackId: LearningTrackId;
};

export type ListTrackPeopleDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Per-row capability bundle so the SPA can disable / hide management
 * affordances without per-row round-trips. The server re-checks every
 * mutation; these are gating hints for the UI.
 */
export type TrackEnrolleeCapabilities = {
  readonly canRemove: boolean;
  readonly canPromote: boolean;
  readonly canDemote: boolean;
};

export type TrackEnrolleeRow = {
  readonly enrollment: TrackEnrollment;
  /**
   * Best-available label for the enrollee. Same resolution order as
   * `list-group-members.ts` so the People views read consistently across
   * the group and track tabs.
   */
  readonly displayName: string;
  /**
   * Group-profile avatar resolved at the same indexed read as the
   * membership lookup. Null when the user has no group profile or has
   * removed their avatar.
   */
  readonly avatarUrl: string | null;
  readonly capabilities: TrackEnrolleeCapabilities;
};

export type ListTrackPeopleResult = {
  readonly track: LearningTrack;
  readonly facilitatorCount: number;
  readonly entries: readonly TrackEnrolleeRow[];
  /**
   * Historic (left) enrollments. Only populated for authority viewers so
   * a participant can't fingerprint who used to be on the track.
   */
  readonly leftEntries: readonly TrackEnrolleeRow[];
};

/**
 * The People tab payload. Splits active vs left into two arrays so the
 * SPA renders the sectioned list (Facilitators / Participants / Left)
 * without partitioning client-side.
 */
export async function listTrackPeople(
  input: ListTrackPeopleInput,
  deps: ListTrackPeopleDeps,
): Promise<ListTrackPeopleResult> {
  const { actor, group, track, groupMembership, trackEnrollment } = await loadViewableTrack(
    input.actor,
    input.trackId,
    deps,
  );

  const isAuthority = isAuthorityOverTrack(track, groupMembership, trackEnrollment);

  const [allRows, facilitatorCount] = await Promise.all([
    deps.tracks.listEnrollments(input.trackId, { includeLeft: isAuthority }),
    deps.tracks.countFacilitators(input.trackId),
  ]);

  // O(rows) point reads on indexed PKs — for a v1 track with ≤ 20
  // enrollees this is well under the per-request budget.
  const owners = await Promise.all(
    allRows.map(async (e) => {
      const [user, membership] = await Promise.all([
        deps.users.byId(e.userId),
        deps.groups.membership(group.id, e.userId),
      ]);
      return { user, membership };
    }),
  );

  function projectRow(e: TrackEnrollment, idx: number): TrackEnrolleeRow {
    const u = owners[idx]?.user ?? null;
    const m = owners[idx]?.membership ?? null;
    const displayName =
      m?.profile.nickname ?? u?.name ?? u?.email ?? m?.displayNameSnapshot ?? "Member";
    const avatarUrl = m?.profile.avatarUrl ?? null;

    const canRemove =
      e.leftAt === null
        ? canRemoveTrackEnrollment(
            group,
            track,
            groupMembership,
            trackEnrollment,
            e,
            facilitatorCount,
          ).ok
        : false;
    const canPromote =
      e.role === "participant" && e.leftAt === null
        ? canAssignTrackFacilitator(group, track, groupMembership, trackEnrollment, e).ok
        : false;
    const canDemote =
      e.role === "facilitator" && e.leftAt === null
        ? canRemoveTrackFacilitator(
            group,
            track,
            groupMembership,
            trackEnrollment,
            e,
            facilitatorCount,
          ).ok
        : false;

    return {
      enrollment: e,
      displayName,
      avatarUrl,
      capabilities: { canRemove, canPromote, canDemote },
    };
  }

  const entries: TrackEnrolleeRow[] = [];
  const leftEntries: TrackEnrolleeRow[] = [];
  allRows.forEach((e, idx) => {
    const row = projectRow(e, idx);
    if (e.leftAt === null) entries.push(row);
    else leftEntries.push(row);
  });

  void actor;
  return { track, facilitatorCount, entries, leftEntries };
}
