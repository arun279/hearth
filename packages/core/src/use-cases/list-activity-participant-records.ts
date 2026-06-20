import {
  type ActivityRecordId,
  type CompletionState,
  DomainError,
  type LearningActivityId,
  type UserId,
} from "@hearth/domain";
import { isAuthorityOverTrack } from "@hearth/domain/policy/is-authority-over-track";
import { canResetParticipantProgress } from "@hearth/domain/policy/record";
import type { ActivityRecordRepository, UserRepository } from "@hearth/ports";
import {
  type LoadViewableActivityDeps,
  loadViewableActivity,
} from "./_lib/load-viewable-activity.ts";

export type ListActivityParticipantRecordsInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
};

export type ListActivityParticipantRecordsDeps = LoadViewableActivityDeps & {
  readonly users: UserRepository;
  readonly records: ActivityRecordRepository;
};

/**
 * One participant's record as the facilitator roster row sees it. Carries the
 * `recordId` (the natural handle for the facilitator's cross-participant read,
 * unlike the owner path which hides it) plus the `participantId` the reset
 * affordance addresses. `partHistoryCount` lets the roster show "N prior
 * attempts preserved" per participant without a per-row follow-up GET.
 */
export type ActivityParticipantRecordRow = {
  readonly recordId: ActivityRecordId;
  readonly participantId: UserId;
  readonly displayName: string;
  readonly completionState: CompletionState;
  readonly completedAt: Date | null;
  readonly partHistoryCount: number;
};

export type ListActivityParticipantRecordsResult = {
  readonly entries: readonly ActivityParticipantRecordRow[];
};

/**
 * The facilitator-facing roster the reset affordance is driven from: every
 * participant who has an Activity Record on this activity, with their display
 * name and completion state. Track-Facilitator / Group-Admin only — the same
 * `canResetParticipantProgress` authority that gates the reset itself, so a
 * roster row is never shown to someone who couldn't act on it.
 *
 * Viewability-before-authorization: `loadViewableActivity` 404s a non-viewer
 * of the parent group before the authority check runs, so the activity id is
 * not an enumeration oracle; an authorized non-facilitator gets a 403.
 */
export async function listActivityParticipantRecords(
  input: ListActivityParticipantRecordsInput,
  deps: ListActivityParticipantRecordsDeps,
): Promise<ListActivityParticipantRecordsResult> {
  const ctx = await loadViewableActivity(input.actor, input.activityId, deps);
  const verdict = canResetParticipantProgress(
    isAuthorityOverTrack(ctx.track, ctx.groupMembership, ctx.trackEnrollment),
  );
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  const { records } = await deps.records.listByActivity(input.activityId);

  // O(rows) point reads on indexed PKs — a v1 activity has ≤ track-size
  // records, well under the per-request budget. Same display-name resolution
  // order as the People views (group nickname → name → email → snapshot).
  const owners = await Promise.all(
    records.map(async (r) => {
      const [user, membership, partHistoryCount] = await Promise.all([
        deps.users.byId(r.participantId),
        deps.groups.membership(ctx.group.id, r.participantId),
        deps.records.countPartHistory(r.id),
      ]);
      return { user, membership, partHistoryCount };
    }),
  );

  const entries = records.map((r, idx): ActivityParticipantRecordRow => {
    const o = owners[idx];
    const displayName =
      o?.membership?.profile.nickname ??
      o?.user?.name ??
      o?.user?.email ??
      o?.membership?.displayNameSnapshot ??
      "Member";
    return {
      recordId: r.id,
      participantId: r.participantId,
      displayName,
      completionState: r.completionState,
      completedAt: r.completedAt,
      partHistoryCount: o?.partHistoryCount ?? 0,
    };
  });

  return { entries };
}
