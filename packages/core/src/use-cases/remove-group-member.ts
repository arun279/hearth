import {
  type AttributionPreference,
  DomainError,
  type StudyGroupId,
  type UserId,
} from "@hearth/domain";
import { canRemoveGroupMember } from "@hearth/domain/policy/can-remove-group-member";
import type {
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup } from "./_lib/load-viewable-group.ts";

export type RemoveGroupMemberInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
  readonly target: UserId;
  /** Defaults to the *target's* user-level preference if absent. */
  readonly attribution?: AttributionPreference;
};

export type RemoveGroupMemberDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * End the target's group membership. Cascades into ending every active
 * Track Enrollment that user holds on tracks belonging to this group —
 * the cascade contract is locked into the LearningTrackRepository port,
 * so M5 lights it up without changing the use-case orchestration here.
 *
 * Attribution snapshot: when `preserve_name` is selected, we capture the
 * target's current display name so the group's history pages can keep
 * attribution stable even after the user changes their account name. When
 * `anonymize`, we drop the snapshot.
 */
export async function removeGroupMember(
  input: RemoveGroupMemberInput,
  deps: RemoveGroupMemberDeps,
): Promise<void> {
  const { actor, group, membership } = await loadViewableGroup(input.actor, input.groupId, deps);

  const [target, targetMembership, adminCount, operator] = await Promise.all([
    deps.users.byId(input.target),
    deps.groups.membership(input.groupId, input.target),
    deps.groups.countAdmins(input.groupId),
    deps.policy.getOperator(input.actor),
  ]);
  if (!targetMembership || targetMembership.removedAt !== null) {
    throw new DomainError("NOT_FOUND", "Target is not a current member.", "not_group_member");
  }

  const verdict = canRemoveGroupMember(
    actor,
    group,
    membership,
    targetMembership,
    adminCount,
    operator,
  );
  if (!verdict.ok) {
    // `would_orphan_admin` is mapped to CONFLICT (409) so the SPA can
    // distinguish "the group changed under you" / "you'd break an
    // invariant" from authorization issues. Other denials (not_group_admin,
    // not_self, etc.) are FORBIDDEN.
    const code = verdict.reason.code === "would_orphan_admin" ? "CONFLICT" : "FORBIDDEN";
    throw new DomainError(code, verdict.reason.message, verdict.reason.code);
  }

  const attribution: AttributionPreference =
    input.attribution ?? target?.attributionPreference ?? "preserve_name";

  await deps.groups.removeMembership({
    groupId: input.groupId,
    userId: input.target,
    by: input.actor,
    attribution,
    displayNameSnapshot: target?.name ?? null,
  });

  // Cascade to track enrollments AFTER the membership write — the contract
  // accepts the no-op fallback (M3 has no enrollments), and a failure here
  // does not roll back the membership removal. M5 will tighten this into a
  // single transaction once the enrollment table is populated.
  await deps.tracks.endAllEnrollmentsForUser({
    groupId: input.groupId,
    userId: input.target,
    by: input.actor,
  });
}
