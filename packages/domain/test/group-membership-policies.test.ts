import { describe, expect, it } from "vitest";
import type { GroupInvitation, GroupMembership, StudyGroup } from "../src/group.ts";
import { invitationStatus, wouldOrphanAdmin } from "../src/group-invariants.ts";
import type { InvitationId, StudyGroupId, UserId } from "../src/ids.ts";
import type { InstanceOperator } from "../src/instance.ts";
import { canAssignGroupAdmin } from "../src/policy/can-assign-group-admin.ts";
import { canConsumeInvitation } from "../src/policy/can-consume-invitation.ts";
import { canCreateGroupInvitation } from "../src/policy/can-create-group-invitation.ts";
import { canLeaveGroup } from "../src/policy/can-leave-group.ts";
import { canManageGroupMembership } from "../src/policy/can-manage-group-membership.ts";
import { canRemoveGroupMember } from "../src/policy/can-remove-group-member.ts";
import { canRevokeGroupInvitation } from "../src/policy/can-revoke-group-invitation.ts";
import { canUpdateOwnGroupProfile } from "../src/policy/can-update-own-group-profile.ts";
import type { User } from "../src/user.ts";

const now = new Date("2026-04-22T00:00:00.000Z");
const nowMs = now.getTime();
const uid = "u_actor" as UserId;
const otherUid = "u_other" as UserId;
const gid = "g_1" as StudyGroupId;

const actor: User = {
  id: uid,
  email: "actor@example.com",
  name: "Actor",
  image: null,
  deactivatedAt: null,
  deletedAt: null,
  attributionPreference: "preserve_name",
  createdAt: now,
  updatedAt: now,
};

const otherActor: User = { ...actor, id: otherUid, email: "other@example.com", name: "Other" };

const activeOp: InstanceOperator = {
  userId: uid,
  grantedAt: now,
  grantedBy: uid,
  revokedAt: null,
  revokedBy: null,
};

const activeGroup: StudyGroup = {
  id: gid,
  name: "G",
  description: null,
  admissionPolicy: "invite_only",
  status: "active",
  archivedAt: null,
  archivedBy: null,
  createdAt: now,
  updatedAt: now,
};
const archivedGroup: StudyGroup = { ...activeGroup, status: "archived", archivedAt: now };

const baseMembership = (overrides: Partial<GroupMembership> = {}): GroupMembership => ({
  groupId: gid,
  userId: uid,
  role: "participant",
  joinedAt: now,
  removedAt: null,
  removedBy: null,
  attributionOnLeave: null,
  displayNameSnapshot: null,
  profile: { nickname: null, avatarUrl: null, bio: null, updatedAt: null },
  ...overrides,
});

const adminMembership = baseMembership({ role: "admin" });
const targetMembership = baseMembership({ userId: otherUid, role: "participant" });

describe("wouldOrphanAdmin", () => {
  it("flags removing the last admin of an active group", () => {
    expect(wouldOrphanAdmin(activeGroup, baseMembership({ role: "admin" }), 1)).toBe(true);
  });
  it("ignores a participant target", () => {
    expect(wouldOrphanAdmin(activeGroup, baseMembership({ role: "participant" }), 1)).toBe(false);
  });
  it("returns false when the group is archived (no live invariant)", () => {
    expect(wouldOrphanAdmin(archivedGroup, baseMembership({ role: "admin" }), 1)).toBe(false);
  });
  it("returns false with another admin remaining", () => {
    expect(wouldOrphanAdmin(activeGroup, baseMembership({ role: "admin" }), 2)).toBe(false);
  });
  it("returns false when target is already removed", () => {
    expect(
      wouldOrphanAdmin(activeGroup, baseMembership({ role: "admin", removedAt: now }), 1),
    ).toBe(false);
  });
});

describe("invitationStatus", () => {
  const liveInv: GroupInvitation = {
    id: "i_1" as InvitationId,
    groupId: gid,
    trackId: null,
    token: "tok",
    email: "invitee@example.com",
    createdBy: uid,
    createdAt: now,
    expiresAt: new Date(nowMs + 24 * 60 * 60 * 1000),
    consumedAt: null,
    consumedBy: null,
    revokedAt: null,
    revokedBy: null,
  };

  it("returns revoked when revokedAt is set, even if also expired", () => {
    expect(
      invitationStatus({ ...liveInv, revokedAt: now, expiresAt: new Date(nowMs - 1) }, true, nowMs),
    ).toBe("revoked");
  });
  it("returns consumed when consumedAt is set", () => {
    expect(invitationStatus({ ...liveInv, consumedAt: now }, true, nowMs)).toBe("consumed");
  });
  it("returns expired when past the expiry", () => {
    expect(invitationStatus({ ...liveInv, expiresAt: new Date(nowMs - 1) }, true, nowMs)).toBe(
      "expired",
    );
  });
  it("returns pending_approval when the email is not yet approved", () => {
    expect(invitationStatus(liveInv, false, nowMs)).toBe("pending_approval");
  });
  it("returns pending when the email is approved", () => {
    expect(invitationStatus(liveInv, true, nowMs)).toBe("pending");
  });
  it("treats a null email as already-approved (open invitation)", () => {
    expect(invitationStatus({ ...liveInv, email: null }, false, nowMs)).toBe("pending");
  });
});

describe("canManageGroupMembership", () => {
  it("allows an active admin", () => {
    expect(canManageGroupMembership(actor, activeGroup, adminMembership, null).ok).toBe(true);
  });
  it("allows an active operator regardless of membership", () => {
    expect(canManageGroupMembership(actor, activeGroup, null, activeOp).ok).toBe(true);
  });
  it("denies a participant", () => {
    const r = canManageGroupMembership(actor, activeGroup, baseMembership(), null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_admin");
  });
  it("denies on archived groups", () => {
    const r = canManageGroupMembership(actor, archivedGroup, adminMembership, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("group_archived");
  });
});

describe("canRemoveGroupMember", () => {
  it("allows an admin to remove a participant", () => {
    expect(
      canRemoveGroupMember(actor, activeGroup, adminMembership, targetMembership, 2, null).ok,
    ).toBe(true);
  });
  it("allows an actor to remove themselves", () => {
    const self = baseMembership();
    expect(canRemoveGroupMember(actor, activeGroup, self, self, 2, null).ok).toBe(true);
  });
  it("denies removing a non-current target", () => {
    const r = canRemoveGroupMember(
      actor,
      activeGroup,
      adminMembership,
      { ...targetMembership, removedAt: now },
      1,
      null,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_member");
  });
  it("denies removing the last admin (orphan)", () => {
    const lastAdmin = baseMembership({ userId: otherUid, role: "admin" });
    const r = canRemoveGroupMember(actor, activeGroup, adminMembership, lastAdmin, 1, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("would_orphan_admin");
  });
  it("denies on archived groups", () => {
    const r = canRemoveGroupMember(
      actor,
      archivedGroup,
      adminMembership,
      targetMembership,
      2,
      null,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("group_archived");
  });
  it("denies a non-admin removing someone else", () => {
    const r = canRemoveGroupMember(actor, activeGroup, baseMembership(), targetMembership, 2, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_admin");
  });
  it("allows an active operator to remove anyone", () => {
    expect(canRemoveGroupMember(actor, activeGroup, null, targetMembership, 2, activeOp).ok).toBe(
      true,
    );
  });
});

describe("canAssignGroupAdmin", () => {
  it("allows an admin to promote a participant", () => {
    expect(
      canAssignGroupAdmin(actor, activeGroup, adminMembership, targetMembership, "admin", 2, null)
        .ok,
    ).toBe(true);
  });
  it("allows an operator to promote", () => {
    expect(
      canAssignGroupAdmin(actor, activeGroup, null, targetMembership, "admin", 2, activeOp).ok,
    ).toBe(true);
  });
  it("denies a non-current target", () => {
    const r = canAssignGroupAdmin(
      actor,
      activeGroup,
      adminMembership,
      { ...targetMembership, removedAt: now },
      "admin",
      2,
      null,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_member");
  });
  it("denies demoting the last admin", () => {
    const lastAdmin = baseMembership({ userId: otherUid, role: "admin" });
    const r = canAssignGroupAdmin(
      actor,
      activeGroup,
      adminMembership,
      lastAdmin,
      "participant",
      1,
      null,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("would_orphan_admin");
  });
  it("denies a non-admin", () => {
    const r = canAssignGroupAdmin(
      actor,
      activeGroup,
      baseMembership(),
      targetMembership,
      "admin",
      2,
      null,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_admin");
  });
  it("denies on archived groups", () => {
    const r = canAssignGroupAdmin(
      actor,
      archivedGroup,
      adminMembership,
      targetMembership,
      "admin",
      2,
      null,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("group_archived");
  });
});

describe("canCreateGroupInvitation", () => {
  it("allows admin", () => {
    expect(canCreateGroupInvitation(actor, activeGroup, adminMembership, null).ok).toBe(true);
  });
  it("allows operator regardless of membership", () => {
    expect(canCreateGroupInvitation(actor, activeGroup, null, activeOp).ok).toBe(true);
  });
  it("denies on archived groups", () => {
    const r = canCreateGroupInvitation(actor, archivedGroup, adminMembership, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("group_archived");
  });
  it("denies a non-admin", () => {
    const r = canCreateGroupInvitation(actor, activeGroup, baseMembership(), null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_admin");
  });
});

describe("canRevokeGroupInvitation", () => {
  it("allows admin", () => {
    expect(canRevokeGroupInvitation(actor, adminMembership, null).ok).toBe(true);
  });
  it("allows operator", () => {
    expect(canRevokeGroupInvitation(actor, null, activeOp).ok).toBe(true);
  });
  it("denies a participant", () => {
    const r = canRevokeGroupInvitation(actor, baseMembership(), null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_admin");
  });
});

describe("canUpdateOwnGroupProfile", () => {
  it("allows the actor to edit their own profile", () => {
    expect(canUpdateOwnGroupProfile(actor, activeGroup, baseMembership(), uid).ok).toBe(true);
  });
  it("denies editing someone else's profile", () => {
    const r = canUpdateOwnGroupProfile(actor, activeGroup, baseMembership(), otherUid);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_self");
  });
  it("denies on archived groups", () => {
    const r = canUpdateOwnGroupProfile(actor, archivedGroup, baseMembership(), uid);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("group_archived");
  });
  it("denies non-members", () => {
    const r = canUpdateOwnGroupProfile(actor, activeGroup, null, uid);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_member");
  });
});

describe("canLeaveGroup", () => {
  it("allows a participant to leave", () => {
    expect(canLeaveGroup(activeGroup, baseMembership(), 2).ok).toBe(true);
  });
  it("denies the last admin from leaving", () => {
    const r = canLeaveGroup(activeGroup, adminMembership, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("would_orphan_admin");
  });
  it("denies leaving an archived group", () => {
    const r = canLeaveGroup(archivedGroup, baseMembership(), 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("group_archived");
  });
  it("denies leaving when not a member", () => {
    const r = canLeaveGroup(activeGroup, null, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_member");
  });
});

describe("canConsumeInvitation", () => {
  const inv: GroupInvitation = {
    id: "i_1" as InvitationId,
    groupId: gid,
    trackId: null,
    token: "tok",
    email: "actor@example.com",
    createdBy: uid,
    createdAt: now,
    expiresAt: new Date(nowMs + 60_000),
    consumedAt: null,
    consumedBy: null,
    revokedAt: null,
    revokedBy: null,
  };

  it("allows consume when the email matches and is approved", () => {
    expect(canConsumeInvitation(actor, inv, true, nowMs).ok).toBe(true);
  });
  it("denies on email mismatch", () => {
    const r = canConsumeInvitation(otherActor, inv, true, nowMs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("invitation_email_mismatch");
  });
  it("denies a revoked invitation", () => {
    const r = canConsumeInvitation(actor, { ...inv, revokedAt: now }, true, nowMs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("invitation_revoked");
  });
  it("denies a consumed invitation", () => {
    const r = canConsumeInvitation(actor, { ...inv, consumedAt: now }, true, nowMs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("invitation_consumed");
  });
  it("denies an expired invitation", () => {
    const r = canConsumeInvitation(actor, { ...inv, expiresAt: new Date(nowMs - 1) }, true, nowMs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("invitation_expired");
  });
  it("denies when the email is not yet approved", () => {
    const r = canConsumeInvitation(actor, inv, false, nowMs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("email_not_approved_yet");
  });
  it("allows consume on an open invitation (no email) when approved", () => {
    expect(canConsumeInvitation(actor, { ...inv, email: null }, true, nowMs).ok).toBe(true);
  });
  it("denies email mismatch when actor has no email", () => {
    const r = canConsumeInvitation({ ...actor, email: null }, inv, true, nowMs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("invitation_email_mismatch");
  });
});
