import {
  DomainError,
  type LibraryItemId,
  type LibraryStewardship,
  type UserId,
} from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  LibraryItemRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadStewardAuthority } from "./_lib/load-steward-authority.ts";

export type AddLibraryStewardInput = {
  readonly actor: UserId;
  readonly itemId: LibraryItemId;
  readonly userId: UserId;
  readonly now: Date;
};

export type AddLibraryStewardDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly library: LibraryItemRepository;
};

/**
 * Promote a Group Member to Library Steward. Stewards can edit the
 * item's metadata, add new revisions, retire it, and recruit other
 * Stewards. The implicit-uploader-is-steward semantic means the uploader
 * is never inserted as an explicit row — calling with `userId =
 * uploadedBy` is a no-op (idempotent at the adapter via ON CONFLICT DO
 * NOTHING) but it's cheaper to short-circuit here too.
 */
export async function addLibrarySteward(
  input: AddLibraryStewardInput,
  deps: AddLibraryStewardDeps,
): Promise<LibraryStewardship | null> {
  const { item } = await loadStewardAuthority(input.actor, input.itemId, deps);

  if (input.userId === item.uploadedBy) {
    // The uploader is an implicit Steward; granting again would only
    // clutter the table. Returning null signals "no row created" without
    // a domain error.
    return null;
  }

  // Defense in depth: only Group Members can be promoted. Adapters do
  // not enforce membership; without this check, a steward could promote
  // an arbitrary user.
  const targetMembership = await deps.groups.membership(item.groupId, input.userId);
  if (targetMembership === null || targetMembership.removedAt !== null) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      "Stewards must be current Group Members.",
      "target_not_member",
    );
  }

  return deps.library.addSteward({
    libraryItemId: input.itemId,
    userId: input.userId,
    grantedBy: input.actor,
    grantedAt: input.now,
  });
}
