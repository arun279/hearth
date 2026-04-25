import type {
  GroupMembership,
  GroupStatus,
  StudyGroup,
  StudyGroupId,
  UserId,
} from "@hearth/domain";

/**
 * Counts of dependent aggregates rendered alongside the group home. Filled in
 * with cheap indexed reads as those aggregates land — every count column has
 * a real index by the time the corresponding milestone ships, so reads stay
 * O(log n) per group.
 */
export type StudyGroupCounts = {
  readonly memberCount: number;
  readonly trackCount: number;
  readonly libraryItemCount: number;
};

export interface StudyGroupRepository {
  /**
   * Atomically inserts the group row AND the creator's first admin
   * membership row in a single D1 batch. There is no observable window in
   * which a group exists without an admin — the orphan-admin invariant is
   * satisfied at creation, and `removeMembership` / `setMembershipRole`
   * (M3) re-check `countAdmins ≥ 1` before allowing a transition that
   * would orphan the group.
   */
  create(input: { name: string; description?: string; createdBy: UserId }): Promise<StudyGroup>;

  byId(id: StudyGroupId): Promise<StudyGroup | null>;

  /** All groups in the instance — used by the operator-only "all groups" view. */
  list(opts?: { status?: GroupStatus }): Promise<readonly StudyGroup[]>;

  /** Groups the user holds an active (un-removed) membership in. */
  listForUser(userId: UserId): Promise<readonly StudyGroup[]>;

  /**
   * Idempotent. Active → archived sets `archivedAt` + `archivedBy`; archived
   * → active clears them. A no-op when the target status equals the current
   * status; the use case maps that to a 200 either way.
   */
  updateStatus(id: StudyGroupId, status: GroupStatus, by: UserId): Promise<void>;

  /**
   * Patch metadata (`name`, `description`). Throws a `DomainError("CONFLICT",
   * …, "group_archived")` when the target group is archived; the API maps
   * that to a 409 with `code: "group_archived"`.
   */
  updateMetadata(
    id: StudyGroupId,
    patch: { readonly name?: string; readonly description?: string | null },
    by: UserId,
  ): Promise<StudyGroup>;

  membership(groupId: StudyGroupId, userId: UserId): Promise<GroupMembership | null>;
  membershipsForUser(userId: UserId): Promise<readonly GroupMembership[]>;

  /**
   * Active admins only. Used by the orphan-admin guard before allowing a
   * mutation that would change the count (membership remove, role change).
   */
  countAdmins(groupId: StudyGroupId): Promise<number>;

  /**
   * Cheap indexed counts attached to the group home response. Track and
   * library counts read 0 until those aggregates have rows.
   */
  counts(groupId: StudyGroupId): Promise<StudyGroupCounts>;
}
