import {
  displayKindFor,
  type LibraryDisplayKind,
  type LibraryItemId,
  type UserId,
} from "@hearth/domain";
import { canAddLibraryRevision } from "@hearth/domain/policy/can-add-library-revision";
import { canAddLibraryStewards } from "@hearth/domain/policy/can-add-library-stewards";
import { canRetireLibraryItem } from "@hearth/domain/policy/can-retire-library-item";
import { canUpdateLibraryMetadata } from "@hearth/domain/policy/can-update-library-metadata";
import type {
  InstanceAccessPolicyRepository,
  LibraryItemDetail,
  LibraryItemRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableLibraryItem } from "./_lib/load-library-item.ts";

/**
 * Server-rendered capability hints surfaced to the SPA so the detail
 * modal can gate affordances locally. The server still re-checks every
 * mutation, so a desync produces a 403 rather than a security hole.
 */
export type LibraryItemCaps = {
  readonly canAddRevision: boolean;
  readonly canRetire: boolean;
  readonly canUpdateMetadata: boolean;
  readonly canManageStewards: boolean;
};

export type GetLibraryItemResult = {
  readonly detail: LibraryItemDetail;
  readonly caps: LibraryItemCaps;
  readonly displayKind: LibraryDisplayKind;
};

export type GetLibraryItemInput = {
  readonly actor: UserId;
  readonly itemId: LibraryItemId;
};

export type GetLibraryItemDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly library: LibraryItemRepository;
};

export async function getLibraryItem(
  input: GetLibraryItemInput,
  deps: GetLibraryItemDeps,
): Promise<GetLibraryItemResult> {
  const { actor, group, membership, operator, item, stewardSet } = await loadViewableLibraryItem(
    input.actor,
    input.itemId,
    deps,
  );
  // Re-fetch the full detail (revisions + stewards + usedInCount) — the
  // viewability loader already touched stewards but not revisions.
  const detail = await deps.library.detail(input.itemId);
  if (!detail) {
    // Race between byId and detail (item retired? deleted?): surface as
    // a stale read; viewability ruled out NOT_FOUND already.
    throw new Error("Library item disappeared between viewability and detail.");
  }

  const caps: LibraryItemCaps = {
    canAddRevision: canAddLibraryRevision(actor.id, group, item, membership, operator, stewardSet)
      .ok,
    canRetire: canRetireLibraryItem(actor.id, group, item, membership, operator, stewardSet).ok,
    canUpdateMetadata: canUpdateLibraryMetadata(
      actor.id,
      group,
      item,
      membership,
      operator,
      stewardSet,
    ).ok,
    canManageStewards: canAddLibraryStewards(
      actor.id,
      group,
      item,
      membership,
      operator,
      stewardSet,
    ).ok,
  };

  const currentMime =
    detail.revisions.find((r) => r.id === detail.item.currentRevisionId)?.mimeType ??
    detail.revisions[0]?.mimeType ??
    "";
  const displayKind = displayKindFor(currentMime);

  return { detail, caps, displayKind };
}
