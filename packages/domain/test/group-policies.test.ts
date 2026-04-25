import { describe, expect, it } from "vitest";
import type { GroupMembership, StudyGroup } from "../src/group.ts";
import type { StudyGroupId, UserId } from "../src/ids.ts";
import type { InstanceOperator } from "../src/instance.ts";
import { canArchiveGroup } from "../src/policy/can-archive-group.ts";
import { canCreateStudyGroup } from "../src/policy/can-create-study-group.ts";
import { canCreateTrack } from "../src/policy/can-create-track.ts";
import { canUnarchiveGroup } from "../src/policy/can-unarchive-group.ts";
import { canUpdateGroupMetadata } from "../src/policy/can-update-group-metadata.ts";
import { canViewGroup } from "../src/policy/can-view-group.ts";
import type { User } from "../src/user.ts";

const now = new Date("2026-04-22T00:00:00.000Z");
const uid = "u_actor" as UserId;
const gid = "g_1" as StudyGroupId;

const actor: User = {
  id: uid,
  email: "u@x.com",
  name: null,
  image: null,
  deactivatedAt: null,
  deletedAt: null,
  attributionPreference: "preserve_name",
  createdAt: now,
  updatedAt: now,
};

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

const adminMembership: GroupMembership = {
  groupId: gid,
  userId: uid,
  role: "admin",
  joinedAt: now,
  removedAt: null,
};

describe("canCreateStudyGroup", () => {
  it("allows an active operator", () => {
    expect(canCreateStudyGroup(actor, activeOp).ok).toBe(true);
  });
  it("denies a non-operator", () => {
    const r = canCreateStudyGroup(actor, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_instance_operator");
  });
  it("denies a revoked operator", () => {
    const r = canCreateStudyGroup(actor, { ...activeOp, revokedAt: now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_instance_operator");
  });
});

describe("canArchiveGroup", () => {
  it("allows a current admin on an active group", () => {
    expect(canArchiveGroup(actor, activeGroup, adminMembership).ok).toBe(true);
  });
  it("allows a current admin on an already-archived group (idempotence handled by use case)", () => {
    expect(canArchiveGroup(actor, { ...activeGroup, status: "archived" }, adminMembership).ok).toBe(
      true,
    );
  });
  it("denies when membership is missing", () => {
    const r = canArchiveGroup(actor, activeGroup, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_admin");
  });
  it("denies when membership is removed", () => {
    const r = canArchiveGroup(actor, activeGroup, { ...adminMembership, removedAt: now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_admin");
  });
  it("denies a participant (non-admin)", () => {
    const r = canArchiveGroup(actor, activeGroup, { ...adminMembership, role: "participant" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_admin");
  });
});

describe("canUnarchiveGroup", () => {
  const archived: StudyGroup = { ...activeGroup, status: "archived", archivedAt: now };
  it("allows a current admin on an archived group", () => {
    expect(canUnarchiveGroup(actor, archived, adminMembership).ok).toBe(true);
  });
  it("allows a current admin on an already-active group (idempotence handled by use case)", () => {
    expect(canUnarchiveGroup(actor, activeGroup, adminMembership).ok).toBe(true);
  });
  it("denies a non-admin", () => {
    const r = canUnarchiveGroup(actor, archived, { ...adminMembership, role: "participant" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_admin");
  });
  it("denies when membership is removed", () => {
    const r = canUnarchiveGroup(actor, archived, { ...adminMembership, removedAt: now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_admin");
  });
});

describe("canUpdateGroupMetadata", () => {
  it("allows a current admin on an active group", () => {
    expect(canUpdateGroupMetadata(actor, activeGroup, adminMembership).ok).toBe(true);
  });
  it("denies on an archived group", () => {
    const r = canUpdateGroupMetadata(
      actor,
      { ...activeGroup, status: "archived" },
      adminMembership,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("group_archived");
  });
  it("denies a non-admin participant", () => {
    const r = canUpdateGroupMetadata(actor, activeGroup, {
      ...adminMembership,
      role: "participant",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_admin");
  });
  it("denies a non-member", () => {
    const r = canUpdateGroupMetadata(actor, activeGroup, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_admin");
  });
});

describe("canViewGroup", () => {
  it("allows an active operator regardless of membership", () => {
    expect(canViewGroup(actor, activeGroup, null, activeOp).ok).toBe(true);
  });
  it("allows a current member", () => {
    expect(
      canViewGroup(actor, activeGroup, { ...adminMembership, role: "participant" }, null).ok,
    ).toBe(true);
  });
  it("allows a current admin", () => {
    expect(canViewGroup(actor, activeGroup, adminMembership, null).ok).toBe(true);
  });
  it("denies a non-member non-operator", () => {
    const r = canViewGroup(actor, activeGroup, null, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_member");
  });
  it("denies a removed member", () => {
    const r = canViewGroup(actor, activeGroup, { ...adminMembership, removedAt: now }, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_member");
  });
  it("denies a revoked operator", () => {
    const r = canViewGroup(actor, activeGroup, null, { ...activeOp, revokedAt: now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_member");
  });
});

describe("canCreateTrack", () => {
  it("allows a current admin on an active group", () => {
    expect(canCreateTrack(actor, activeGroup, adminMembership).ok).toBe(true);
  });
  it("denies on an archived group", () => {
    const r = canCreateTrack(actor, { ...activeGroup, status: "archived" }, adminMembership);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("group_archived");
  });
  it("denies when not a member", () => {
    const r = canCreateTrack(actor, activeGroup, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_a_member");
  });
  it("denies when removed", () => {
    const r = canCreateTrack(actor, activeGroup, { ...adminMembership, removedAt: now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_a_member");
  });
  it("denies a participant (non-admin)", () => {
    const r = canCreateTrack(actor, activeGroup, { ...adminMembership, role: "participant" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("not_group_admin");
  });
});
