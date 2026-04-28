import { DomainError, type LibraryItemId, type UserId } from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  LibraryItemRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadStewardAuthority } from "./_lib/load-steward-authority.ts";

export type RemoveLibraryStewardInput = {
  readonly actor: UserId;
  readonly itemId: LibraryItemId;
  readonly userId: UserId;
};

export type RemoveLibraryStewardDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly library: LibraryItemRepository;
};

/**
 * Demote a Library Steward back to plain Group Member status. The
 * uploader is *implicit* — there's no row to remove and `removeSteward`
 * on the uploader is rejected so the SPA can surface "the uploader is
 * always a Steward" rather than silently no-op-ing. Group Admins keep
 * their authority via the policy regardless of any explicit row.
 */
export async function removeLibrarySteward(
  input: RemoveLibraryStewardInput,
  deps: RemoveLibraryStewardDeps,
): Promise<void> {
  const { item } = await loadStewardAuthority(input.actor, input.itemId, deps);

  if (input.userId === item.uploadedBy) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      "The original uploader cannot be removed as a Steward.",
      "cannot_remove_uploader",
    );
  }

  await deps.library.removeSteward({
    libraryItemId: input.itemId,
    userId: input.userId,
  });
}
