import type { LibraryItemId, LibraryRevisionId, StudyGroupId, UserId } from "@hearth/domain";

export type LibrarySearchOpts = {
  readonly query: string;
  readonly limit?: number;
  readonly cursor?: string;
};

export type LibraryItemSummary = {
  readonly id: LibraryItemId;
  readonly title: string;
  readonly description: string | null;
  readonly retiredAt: Date | null;
};

export interface LibraryItemRepository {
  byId(id: LibraryItemId): Promise<LibraryItemSummary | null>;
  byGroup(groupId: StudyGroupId): Promise<readonly LibraryItemSummary[]>;
  markRetired(id: LibraryItemId, by: UserId): Promise<void>;
  currentRevision(itemId: LibraryItemId): Promise<LibraryRevisionId | null>;
  search(groupId: StudyGroupId, opts: LibrarySearchOpts): Promise<readonly LibraryItemSummary[]>;
}
