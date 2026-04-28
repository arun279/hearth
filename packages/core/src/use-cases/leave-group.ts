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

  // Orphan refusal mirrors `removeGroupMember`: if leaving would strand
  // any track in the group with zero active facilitators, surface the
  // offending track names so the actor can promote a replacement first.
  const orphanedTracks = await deps.tracks.findTracksOrphanedByMemberRemoval({
    groupId: input.groupId,
    userId: input.actor,
  });
  if (orphanedTracks.length > 0) {
    const names = orphanedTracks.map((t) => t.trackName).join(", ");
    throw new DomainError(
      "CONFLICT",
      `Leaving would strand the following tracks with no facilitators: ${names}. Promote a replacement on each before leaving.`,
      "would_orphan_facilitator",
    );
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
