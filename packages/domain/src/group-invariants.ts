import type {
  GroupInvitation,
  GroupInvitationStatus,
  GroupMembership,
  StudyGroup,
} from "./group.ts";
import type { StudyGroupId } from "./ids.ts";

/**
 * Pure helpers + invariants over the StudyGroup aggregate. The SPA imports
 * these directly so capability gating stays in lockstep with server policy
 * — keep this file free of Node globals, `Date.now()`, and `crypto.*`.
 */

export function isCurrentMembership(
  membership: GroupMembership | null,
  groupId: StudyGroupId,
): boolean {
  return membership !== null && membership.removedAt === null && membership.groupId === groupId;
}

export function isCurrentAdmin(membership: GroupMembership | null, groupId: StudyGroupId): boolean {
  return isCurrentMembership(membership, groupId) && membership!.role === "admin";
}

/**
 * True iff removing OR demoting the target membership would leave zero
 * active admins on the group. The caller passes `currentAdminCount`
 * (cheap indexed read) so the predicate stays sync + pure.
 *
 * The transition is "would orphan" when:
 *  - the target is currently an active admin of this group, AND
 *  - the active admin count is 1 (only this admin left), AND
 *  - the group is still active (archived groups intentionally allow the
 *    admin count to fall to zero — frozen aggregates have no admin
 *    invariant).
 */
export function wouldOrphanAdmin(
  group: StudyGroup,
  target: GroupMembership,
  currentAdminCount: number,
): boolean {
  if (group.status === "archived") return false;
  if (target.removedAt !== null) return false;
  if (target.role !== "admin") return false;
  return currentAdminCount <= 1;
}

/**
 * Project an Invitation row into its derived status. A user-facing copy
 * decision (the `pending_approval` wedge) lives in this single function so
 * the SPA and the API agree without round-tripping a derived value.
 *
 * `nowMs` is an epoch-millisecond number rather than a `Date` so this
 * function — and the policy predicates that wrap it — stay free of the
 * `Date` global, which CI rule 9 forbids in SPA-importable modules.
 *
 * The order of checks matters: `revoked` and `consumed` win over
 * `expired` because once an invitation is finalized one way, the expiry
 * timestamp ceases to matter — we want the projection to reflect the
 * terminal event, not the calendar.
 */
export function invitationStatus(
  invitation: GroupInvitation,
  isEmailApproved: boolean,
  nowMs: number,
): GroupInvitationStatus {
  if (invitation.revokedAt !== null) return "revoked";
  if (invitation.consumedAt !== null) return "consumed";
  if (invitation.expiresAt.getTime() <= nowMs) return "expired";
  if (invitation.email !== null && !isEmailApproved) return "pending_approval";
  return "pending";
}
