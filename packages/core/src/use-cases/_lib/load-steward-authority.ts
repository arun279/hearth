import type { LibraryItemId, UserId } from "@hearth/domain";
import { DomainError } from "@hearth/domain";
import { canAddLibraryStewards } from "@hearth/domain/policy/can-add-library-stewards";
import {
  type LoadViewableLibraryItemDeps,
  loadViewableLibraryItem,
  type ViewableLibraryItemContext,
} from "./load-library-item.ts";

/**
 * Shared entry point for the steward-management use cases (add and
 * remove). Loads the library item via viewability + assembles the
 * steward set, then runs the symmetric `canAddLibraryStewards` predicate.
 *
 * Add and remove share the SAME predicate — the policy decides whether
 * the actor may *manage* stewards, and the per-action invariants
 * ("can't grant uploader twice", "can't remove uploader") live in the
 * use cases. Centralizing the load + verdict here keeps the mirror pair
 * a one-line call.
 */
export async function loadStewardAuthority(
  actorId: UserId,
  itemId: LibraryItemId,
  deps: LoadViewableLibraryItemDeps,
): Promise<ViewableLibraryItemContext> {
  const ctx = await loadViewableLibraryItem(actorId, itemId, deps);
  const verdict = canAddLibraryStewards(
    ctx.actor.id,
    ctx.group,
    ctx.item,
    ctx.membership,
    ctx.operator,
    ctx.stewardSet,
  );
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }
  return ctx;
}
