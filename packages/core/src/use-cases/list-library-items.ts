import {
  displayKindFor,
  type LibraryDisplayKind,
  type StudyGroupId,
  type UserId,
} from "@hearth/domain";
import { canUploadLibraryItem } from "@hearth/domain/policy/can-upload-library-item";
import type {
  InstanceAccessPolicyRepository,
  LibraryItemListEntry,
  LibraryItemRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup } from "./_lib/load-viewable-group.ts";

export type LibraryListEntry = LibraryItemListEntry & {
  readonly displayKind: LibraryDisplayKind;
};

export type LibraryListCaps = {
  readonly canUpload: boolean;
};

export type ListLibraryItemsResult = {
  readonly entries: readonly LibraryListEntry[];
  readonly caps: LibraryListCaps;
};

export type ListLibraryItemsInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
};

export type ListLibraryItemsDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly library: LibraryItemRepository;
};

export async function listLibraryItems(
  input: ListLibraryItemsInput,
  deps: ListLibraryItemsDeps,
): Promise<ListLibraryItemsResult> {
  const { actor, group, membership } = await loadViewableGroup(input.actor, input.groupId, deps);

  const rows = await deps.library.byGroup(input.groupId);
  const entries = rows.map((row) => ({
    ...row,
    displayKind: displayKindFor(row.currentRevision?.mimeType ?? ""),
  }));

  return {
    entries,
    caps: {
      canUpload: canUploadLibraryItem(actor, group, membership).ok,
    },
  };
}
