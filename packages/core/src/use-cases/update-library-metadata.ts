import {
  DomainError,
  type LibraryItem,
  type LibraryItemId,
  normalizeTags,
  type UserId,
} from "@hearth/domain";
import { canUpdateLibraryMetadata } from "@hearth/domain/policy/can-update-library-metadata";
import type {
  InstanceAccessPolicyRepository,
  LibraryItemRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableLibraryItem } from "./_lib/load-library-item.ts";

export type UpdateLibraryMetadataInput = {
  readonly actor: UserId;
  readonly itemId: LibraryItemId;
  readonly title?: string;
  readonly description?: string | null;
  readonly tags?: readonly string[];
};

export type UpdateLibraryMetadataDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly library: LibraryItemRepository;
};

export async function updateLibraryMetadata(
  input: UpdateLibraryMetadataInput,
  deps: UpdateLibraryMetadataDeps,
): Promise<LibraryItem> {
  const { actor, group, membership, operator, item, stewardSet } = await loadViewableLibraryItem(
    input.actor,
    input.itemId,
    deps,
  );

  const verdict = canUpdateLibraryMetadata(actor.id, group, item, membership, operator, stewardSet);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  if (input.title !== undefined && input.title.trim().length === 0) {
    throw new DomainError("INVARIANT_VIOLATION", "Title cannot be empty.", "invalid_title");
  }

  return deps.library.updateMetadata(input.itemId, {
    ...(input.title !== undefined ? { title: input.title.trim() } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.tags !== undefined ? { tags: normalizeTags(input.tags) } : {}),
  });
}
