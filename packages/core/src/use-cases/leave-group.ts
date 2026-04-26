import {
  type AttributionPreference,
  DomainError,
  type StudyGroupId,
  type UserId,
} from "@hearth/domain";
import { canLeaveGroup } from "@hearth/domain/policy/can-leave-group";
import type {
  InstanceAccessPolicyRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup } from "./_lib/load-viewable-group.ts";

export type LeaveGroupInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
  readonly attribution?: AttributionPreference;
};

export type LeaveGroupDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
};

/**
 * Self-leave. Functionally `removeGroupMember(actor, actor)` with the
 * orphan-admin check still active. We keep it as its own use case so the
 * SPA's leave flow has a distinct route + telemetry; the underlying
 * adapter call is identical.
 */
export async function leaveGroup(input: LeaveGroupInput, deps: LeaveGroupDeps): Promise<void> {
  const { actor, group, membership } = await loadViewableGroup(input.actor, input.groupId, deps);

  const adminCount = await deps.groups.countAdmins(input.groupId);
  const verdict = canLeaveGroup(group, membership, adminCount);
  if (!verdict.ok) {
    const code = verdict.reason.code === "would_orphan_admin" ? "CONFLICT" : "FORBIDDEN";
    throw new DomainError(code, verdict.reason.message, verdict.reason.code);
  }

  const attribution: AttributionPreference =
    input.attribution ?? actor.attributionPreference ?? "preserve_name";

  await deps.groups.removeMembership({
    groupId: input.groupId,
    userId: input.actor,
    by: input.actor,
    attribution,
    displayNameSnapshot: actor.name ?? null,
  });

  await deps.tracks.endAllEnrollmentsForUser({
    groupId: input.groupId,
    userId: input.actor,
    by: input.actor,
  });
}
