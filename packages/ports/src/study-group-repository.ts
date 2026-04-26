import type {
  AttributionPreference,
  GroupInvitation,
  GroupMembership,
  GroupRole,
  GroupStatus,
  InvitationId,
  LearningTrackId,
  StudyGroup,
  StudyGroupId,
  TrackEnrollment,
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

export type CreateInvitationInput = {
  readonly groupId: StudyGroupId;
  readonly trackId: LearningTrackId | null;
  readonly token: string;
  readonly email: string | null;
  readonly createdBy: UserId;
  readonly expiresAt: Date;
};

export type ConsumeInvitationInput = {
  readonly invitationId: InvitationId;
  readonly userId: UserId;
  readonly now: Date;
};

export type ConsumeInvitationResult = {
  readonly membership: GroupMembership;
  readonly enrollment: TrackEnrollment | null;
};

export type GroupProfilePatch = {
  readonly nickname?: string | null;
  readonly avatarUrl?: string | null;
  readonly bio?: string | null;
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

  // ── Memberships ────────────────────────────────────────────────────────

  membership(groupId: StudyGroupId, userId: UserId): Promise<GroupMembership | null>;
  membershipsForUser(userId: UserId): Promise<readonly GroupMembership[]>;

  /**
   * Active (un-removed) memberships in the group, ordered by `joinedAt` for
   * a stable People-page list. Active group admins surface with `role: "admin"`.
   */
  listMemberships(groupId: StudyGroupId): Promise<readonly GroupMembership[]>;

  listAdmins(groupId: StudyGroupId): Promise<readonly GroupMembership[]>;

  /**
   * Active admins only. Used by the orphan-admin guard before allowing a
   * mutation that would change the count (membership remove, role change).
   */
  countAdmins(groupId: StudyGroupId): Promise<number>;

  /**
   * Insert a new active membership. Idempotent on the (groupId, userId)
   * unique index — re-adding a current member returns the existing row.
   */
  addMembership(input: {
    groupId: StudyGroupId;
    userId: UserId;
    role: GroupRole;
    by: UserId;
  }): Promise<GroupMembership>;

  /**
   * End the membership. The orphan check runs inside the same D1
   * transaction as the UPDATE; throws `DomainError("CONFLICT",
   * "would_orphan_admin")` if applying the change would leave the group
   * with zero active admins.
   *
   * `displayNameSnapshot` is captured iff `attribution === "preserve_name"`
   * so the group's history pages can still attribute past contributions
   * after the user changes their account name.
   */
  removeMembership(input: {
    groupId: StudyGroupId;
    userId: UserId;
    by: UserId;
    attribution: AttributionPreference;
    displayNameSnapshot: string | null;
  }): Promise<void>;

  /**
   * Promote/demote between participant and admin. Same transactional orphan
   * check as removal; throws `would_orphan_admin` when demoting the last
   * admin.
   */
  setMembershipRole(input: {
    groupId: StudyGroupId;
    userId: UserId;
    role: GroupRole;
    by: UserId;
  }): Promise<GroupMembership>;

  /**
   * Self-service profile update. The avatar URL stored here points at an R2
   * key; the use case is responsible for queueing the prior key for cleanup
   * AFTER the DB write commits (so a transient R2 failure cannot roll back
   * the profile change).
   */
  updateProfile(input: {
    groupId: StudyGroupId;
    userId: UserId;
    patch: GroupProfilePatch;
  }): Promise<GroupMembership>;

  // ── Invitations ────────────────────────────────────────────────────────

  createInvitation(input: CreateInvitationInput): Promise<GroupInvitation>;
  invitationByToken(token: string): Promise<GroupInvitation | null>;
  invitationById(id: InvitationId): Promise<GroupInvitation | null>;

  /** All non-terminal invitations on the group (not consumed, not revoked, not expired-at-now). */
  listPendingInvitations(groupId: StudyGroupId, now: Date): Promise<readonly GroupInvitation[]>;

  /** Idempotent: revoking an already-revoked invitation is a no-op. */
  revokeInvitation(input: { id: InvitationId; by: UserId; now: Date }): Promise<void>;

  /**
   * Atomic consume: when the M5 enrollment guard is on AND `trackId` is
   * non-null, the same D1 batch also inserts a track enrollment row. M3
   * sets the guard off so the enrollment branch is skipped — the use case
   * receives `enrollment: null` and the SPA renders the membership-only
   * outcome.
   *
   * Re-running consume on an already-consumed invitation is rejected at
   * the policy layer; the adapter additionally guards via a conditional
   * UPDATE so two simultaneous consumers cannot both succeed.
   */
  consumeInvitation(input: ConsumeInvitationInput): Promise<ConsumeInvitationResult>;

  /**
   * Cheap indexed counts attached to the group home response. Track and
   * library counts read 0 until those aggregates have rows.
   */
  counts(groupId: StudyGroupId): Promise<StudyGroupCounts>;
}
