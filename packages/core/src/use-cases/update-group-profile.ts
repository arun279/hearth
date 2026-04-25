import { DomainError, type GroupMembership, type StudyGroupId, type UserId } from "@hearth/domain";
import { canUpdateOwnGroupProfile } from "@hearth/domain/policy/can-update-own-group-profile";
import type {
  GroupProfilePatch,
  InstanceAccessPolicyRepository,
  ObjectStorage,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup } from "./_lib/load-viewable-group.ts";

export type UpdateGroupProfileInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
  readonly target: UserId;
  readonly patch: GroupProfilePatch;
};

export type UpdateGroupProfileDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly storage: ObjectStorage;
};

const MAX_NICKNAME = 60;
const MAX_BIO = 800;

/**
 * Update the actor's per-group profile (nickname / avatar / bio). The
 * avatar URL is stored as the R2 key the SPA reads through the public
 * bucket origin; if the avatar changes, the prior key is best-effort
 * deleted AFTER the DB write commits. A transient R2 error therefore
 * cannot roll back the profile change — the orphan-key cleanup is a
 * job the hourly sweep can re-run.
 */
export async function updateGroupProfile(
  input: UpdateGroupProfileInput,
  deps: UpdateGroupProfileDeps,
): Promise<GroupMembership> {
  const { actor, group, membership } = await loadViewableGroup(input.actor, input.groupId, deps);

  const verdict = canUpdateOwnGroupProfile(actor, group, membership, input.target);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  if (input.patch.nickname !== undefined && input.patch.nickname !== null) {
    const trimmed = input.patch.nickname.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_NICKNAME) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        `Nickname must be between 1 and ${MAX_NICKNAME} characters.`,
        "invalid_nickname",
      );
    }
  }
  if (input.patch.bio !== undefined && input.patch.bio !== null) {
    if (input.patch.bio.length > MAX_BIO) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        `Bio must be ${MAX_BIO} characters or fewer.`,
        "invalid_bio",
      );
    }
  }

  const previousAvatarUrl = membership?.profile.avatarUrl ?? null;
  const updated = await deps.groups.updateProfile({
    groupId: input.groupId,
    userId: input.target,
    patch: input.patch,
  });

  // Best-effort orphan cleanup: when the avatar URL changes, drop the
  // prior R2 key. The storage call may fail silently (e.g. transient R2
  // outage); the hourly `pending_uploads` sweep does not pick this up
  // because the key is not in `pending_uploads` — for now the orphan is
  // small (one avatar per (user, group)). M6 widens the sweep contract.
  if (
    input.patch.avatarUrl !== undefined &&
    previousAvatarUrl !== null &&
    previousAvatarUrl !== input.patch.avatarUrl
  ) {
    try {
      await deps.storage.delete(previousAvatarUrl);
    } catch {
      // Swallow — the membership row update already landed; an orphan
      // R2 key is wasted bytes, not a correctness violation.
    }
  }

  return updated;
}
