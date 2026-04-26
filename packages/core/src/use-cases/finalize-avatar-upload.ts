import { DomainError, type GroupMembership, type StudyGroupId, type UserId } from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  ObjectStorage,
  StudyGroupRepository,
  UploadCoordinationRepository,
  UserRepository,
} from "@hearth/ports";
import { updateGroupProfile } from "./update-group-profile.ts";

export type FinalizeAvatarUploadInput = {
  readonly actor: UserId;
  /**
   * The group whose avatar surface this finalize call is bound to.
   * Asserted against the pending-upload row's `groupId` so that
   * `POST /g/WRONG_GROUP/avatar/finalize { uploadId }` cannot apply
   * an avatar to a different group than the URL claims.
   */
  readonly groupId: StudyGroupId;
  readonly uploadId: string;
};

export type FinalizeAvatarUploadDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly storage: ObjectStorage;
  readonly uploads: UploadCoordinationRepository;
};

/**
 * Finalize a successful avatar PUT: verify the R2 object landed at the
 * pending key with the declared size, write the new avatar URL onto the
 * actor's group profile, and drop the coordination row. Failure cases:
 *
 * - `pending_upload_not_found` (404) — the uploadId is unknown OR was
 *   issued to a different user. We refuse to finalize anyone else's row.
 * - `upload_missing` (422) — the R2 head call returned null; the client
 *   never completed the PUT.
 * - `upload_size_mismatch` (422) — the R2 object size differs from what
 *   was declared at request time. We delete the suspect object and the
 *   pending row so the user can retry.
 *
 * The pending row is dropped only on the success path so a transient
 * failure here lets the cron sweep clean up later.
 */
export async function finalizeAvatarUpload(
  input: FinalizeAvatarUploadInput,
  deps: FinalizeAvatarUploadDeps,
): Promise<GroupMembership> {
  const pending = await deps.uploads.getPending(input.uploadId);
  if (
    !pending ||
    pending.uploaderUserId !== input.actor ||
    pending.context !== "avatar" ||
    // URL groupId must match the pending row's groupId. Without this
    // assert, the URL is decorative and a user could finalize an
    // avatar against any group whose path they happen to type.
    pending.groupId !== input.groupId
  ) {
    throw new DomainError("NOT_FOUND", "Pending upload not found.", "pending_upload_not_found");
  }

  const head = await deps.storage.headObject(pending.storageKey);
  if (!head) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      "Upload did not complete — no object at the expected key.",
      "upload_missing",
    );
  }
  if (head.size !== pending.declaredSizeBytes) {
    // Best-effort cleanup of the orphan R2 object + pending row so a
    // retry starts clean. Failures here are swallowed because the throw
    // below already signals the client.
    await Promise.allSettled([
      deps.storage.delete(pending.storageKey),
      deps.uploads.deletePending(input.uploadId),
    ]);
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Uploaded size (${head.size}) does not match the declared size (${pending.declaredSizeBytes}).`,
      "upload_size_mismatch",
    );
  }

  // Materialize the membership profile change. update-group-profile
  // queues the prior avatar key for cleanup, so the chain is:
  //   1) write new key into group profile (this call)
  //   2) drop the pending_uploads row (below)
  //   3) (best-effort) delete the previous avatar key (inside update)
  const membership = await updateGroupProfile(
    {
      actor: input.actor,
      groupId: pending.groupId,
      target: input.actor,
      patch: { avatarUrl: pending.storageKey },
    },
    deps,
  );

  await deps.uploads.deletePending(input.uploadId);
  return membership;
}
