import type { InvitationId, LearningTrackId, StudyGroupId, UserId } from "./ids.ts";
import type { AttributionPreference } from "./user.ts";

export type GroupStatus = "active" | "archived";
export type AdmissionPolicy = "open" | "invite_only";
export type GroupRole = "participant" | "admin";

export type StudyGroup = {
  readonly id: StudyGroupId;
  readonly name: string;
  readonly description: string | null;
  readonly admissionPolicy: AdmissionPolicy;
  readonly status: GroupStatus;
  readonly archivedAt: Date | null;
  readonly archivedBy: UserId | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/**
 * The person-facing presentation a Group Member chooses *for this group*. A
 * user has one row per active membership so the same User can show up as
 * "Sam — facilitator" in one group and just "Sam" in another. The avatar URL
 * is the public R2 path the SPA reads when rendering; updating it queues the
 * old key for cleanup so we don't leak storage.
 */
export type GroupProfile = {
  readonly nickname: string | null;
  readonly avatarUrl: string | null;
  readonly bio: string | null;
  readonly updatedAt: Date | null;
};

export type GroupMembership = {
  readonly groupId: StudyGroupId;
  readonly userId: UserId;
  readonly role: GroupRole;
  readonly joinedAt: Date;
  readonly removedAt: Date | null;
  readonly removedBy: UserId | null;
  /**
   * Snapshotted at leave/remove time so the group's history can attribute
   * past contributions even after the user changes their account name. Null
   * while the membership is active.
   */
  readonly attributionOnLeave: AttributionPreference | null;
  readonly displayNameSnapshot: string | null;
  readonly profile: GroupProfile;
};

/**
 * Derived (never stored) status of an Invitation as projected to the SPA.
 * `pending_approval` is the wedge-state on a private instance: the invitation
 * is alive, but the recipient's email isn't on the Approved Email allowlist
 * so signing in will still bounce until an Operator approves it.
 */
export type GroupInvitationStatus =
  | "pending"
  | "pending_approval"
  | "consumed"
  | "revoked"
  | "expired";

export type GroupInvitation = {
  readonly id: InvitationId;
  readonly groupId: StudyGroupId;
  readonly trackId: LearningTrackId | null;
  readonly token: string;
  readonly email: string | null;
  readonly createdBy: UserId;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly consumedBy: UserId | null;
  readonly revokedAt: Date | null;
  readonly revokedBy: UserId | null;
};
