import type {
  GroupMembership,
  LearningTrack,
  StudyGroup,
  TrackEnrollment,
  User,
} from "@hearth/domain";
import {
  DomainError,
  type LearningActivity,
  type LearningActivityId,
  type LearningActivityListRow,
  type PolicyResult,
  type UserId,
} from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableActivity } from "./load-viewable-activity.ts";

export type LoadEditableActivityWithSiblingsDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly activities: LearningActivityRepository;
};

type ScopePolicy = (
  actor: User,
  group: StudyGroup,
  track: LearningTrack,
  groupMembership: GroupMembership | null,
  trackEnrollment: TrackEnrollment | null,
) => PolicyResult;

/**
 * Shared shape used by `set-prerequisites` and `set-suggested-sequences`:
 * load the activity (gated by viewability), run the action-specific
 * Activity-scope policy gate, and return both the activity AND the
 * same-track sibling list. The same-track invariant ("a prereq /
 * suggested-next must live on the same track") then runs in O(target
 * ids) rather than per-id D1 hops.
 */
export async function loadEditableActivityWithSiblings(
  actor: UserId,
  activityId: LearningActivityId,
  policy: ScopePolicy,
  deps: LoadEditableActivityWithSiblingsDeps,
): Promise<{
  readonly activity: LearningActivity;
  readonly siblings: readonly LearningActivityListRow[];
  readonly siblingIds: ReadonlySet<LearningActivityId>;
}> {
  const ctx = await loadViewableActivity(actor, activityId, deps);

  const verdict = policy(ctx.actor, ctx.group, ctx.track, ctx.groupMembership, ctx.trackEnrollment);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  const siblings = await deps.activities.byTrack(ctx.activity.trackId);
  const siblingIds = new Set(siblings.map((s) => s.id));
  return { activity: ctx.activity, siblings, siblingIds };
}
