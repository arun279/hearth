import {
  displayKindFor,
  type LibraryDisplayKind,
  normalizeSearchQuery,
  type StudyGroupId,
  type UserId,
} from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  LibraryItemListEntry,
  LibraryItemRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup } from "./_lib/load-viewable-group.ts";

export type LibrarySearchEntry = LibraryItemListEntry & {
  readonly displayKind: LibraryDisplayKind;
};

export type SearchLibraryResult = {
  readonly entries: readonly LibrarySearchEntry[];
  readonly nextCursor: string | null;
};

export type SearchLibraryInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
  readonly query: string;
  readonly limit?: number;
  readonly cursor?: string | null;
};

export type SearchLibraryDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly library: LibraryItemRepository;
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MIN_LIMIT = 1;

/**
 * The empty-query short-circuit. Returning a populated empty page
 * (200 + entries: []) instead of an error keeps the SPA's debounced
 * search input simple — every keystroke can dispatch without a flash
 * of error state when the user briefly clears the box.
 */
const EMPTY_PAGE: SearchLibraryResult = { entries: [], nextCursor: null };

export async function searchLibrary(
  input: SearchLibraryInput,
  deps: SearchLibraryDeps,
): Promise<SearchLibraryResult> {
  // `loadViewableGroup` enforces 404-on-non-member (viewability before
  // authorization) — search must not leak group existence to outsiders.
  await loadViewableGroup(input.actor, input.groupId, deps);

  const matchExpr = normalizeSearchQuery(input.query);
  if (matchExpr === null) return EMPTY_PAGE;

  const limit = clampLimit(input.limit);
  const cursor = input.cursor ?? null;

  const page = await deps.library.search(input.groupId, {
    query: matchExpr,
    limit,
    cursor,
  });

  const entries = page.entries.map((row) => ({
    ...row,
    displayKind: displayKindFor(row.currentRevision?.mimeType ?? ""),
  }));

  return { entries, nextCursor: page.nextCursor };
}

function clampLimit(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_LIMIT;
  if (requested < MIN_LIMIT) return MIN_LIMIT;
  if (requested > MAX_LIMIT) return MAX_LIMIT;
  return Math.floor(requested);
}
