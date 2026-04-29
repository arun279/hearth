import { DomainError, type LibraryItem, type LibraryItemId, type UserId } from "@hearth/domain";
import { canRetireLibraryItem } from "@hearth/domain/policy/can-retire-library-item";
import type {
  InstanceAccessPolicyRepository,
  LibraryItemRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableLibraryItem } from "./_lib/load-library-item.ts";

export type RetireLibraryItemInput = {
  readonly actor: UserId;
  readonly itemId: LibraryItemId;
  readonly now: Date;
};

export type RetireLibraryItemDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly library: LibraryItemRepository;
};

/**
 * Soft-retire: marks the item as retired so new activities can't attach
 * to it, but every existing reference (including pinned revisions in
 * activity_library_refs) keeps reading the body. Idempotent — calling
 * twice returns the existing retired row, no error.
 */
export async function retireLibraryItem(
  input: RetireLibraryItemInput,
  deps: RetireLibraryItemDeps,
): Promise<LibraryItem> {
  const { actor, group, membership, operator, item, stewardSet } = await loadViewableLibraryItem(
    input.actor,
    input.itemId,
    deps,
  );

  const verdict = canRetireLibraryItem(actor.id, group, item, membership, operator, stewardSet);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  return deps.library.markRetired(input.itemId, input.actor, input.now);
}
