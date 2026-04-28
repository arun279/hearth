import { describe, expect, it } from "vitest";
import type { GroupMembership, StudyGroup } from "../src/group.ts";
import type { LibraryItemId, LibraryRevisionId, StudyGroupId, UserId } from "../src/ids.ts";
import type { InstanceOperator } from "../src/instance.ts";
import type { LibraryItem } from "../src/library/types.ts";
import { canAddLibraryRevision } from "../src/policy/can-add-library-revision.ts";
import { canAddLibraryStewards } from "../src/policy/can-add-library-stewards.ts";
import { canAttachLibraryItemToActivity } from "../src/policy/can-attach-library-item-to-activity.ts";
import { canRetireLibraryItem } from "../src/policy/can-retire-library-item.ts";
import { canUpdateLibraryMetadata } from "../src/policy/can-update-library-metadata.ts";
import { canUploadLibraryItem } from "../src/policy/can-upload-library-item.ts";
import { isLibraryItemSteward } from "../src/policy/library-stewardship.ts";
import type { User } from "../src/user.ts";

const now = new Date("2026-04-22T00:00:00.000Z");

const uid = "u_actor" as UserId;
const otherUid = "u_other" as UserId;
const uploaderUid = "u_uploader" as UserId;
const gid = "g_1" as StudyGroupId;
const itemId = "li_1" as LibraryItemId;

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

const archivedGroup: StudyGroup = {
  ...activeGroup,
  status: "archived",
  archivedAt: now,
  archivedBy: uid,
};

const memberMembership: GroupMembership = {
  groupId: gid,
  userId: uid,
  role: "participant",
  joinedAt: now,
  removedAt: null,
  removedBy: null,
  attributionOnLeave: null,
  displayNameSnapshot: null,
  profile: { nickname: null, avatarUrl: null, bio: null, updatedAt: null },
};

const adminMembership: GroupMembership = { ...memberMembership, role: "admin" };

const removedMembership: GroupMembership = {
  ...memberMembership,
  removedAt: now,
  removedBy: uid,
};

const livingItem: LibraryItem = {
  id: itemId,
  groupId: gid,
  title: "Primer",
  description: null,
  tags: [],
  currentRevisionId: "lr_1" as LibraryRevisionId,
  uploadedBy: uploaderUid,
  retiredAt: null,
  retiredBy: null,
  createdAt: now,
  updatedAt: now,
};

const retiredItem: LibraryItem = { ...livingItem, retiredAt: now, retiredBy: uid };

const activeOperator: InstanceOperator = {
  userId: uid,
  grantedAt: now,
  grantedBy: uid,
  revokedAt: null,
  revokedBy: null,
};

const noStewards: ReadonlySet<UserId> = new Set();

describe("isLibraryItemSteward", () => {
  it("accepts the original uploader without a row", () => {
    expect(isLibraryItemSteward(uploaderUid, livingItem, null, null, noStewards)).toBe(true);
  });

  it("accepts a Group Admin even without a row", () => {
    expect(isLibraryItemSteward(uid, livingItem, adminMembership, null, noStewards)).toBe(true);
  });

  it("accepts an Instance Operator", () => {
    expect(isLibraryItemSteward(uid, livingItem, null, activeOperator, noStewards)).toBe(true);
  });

  it("accepts an explicit steward by id", () => {
    expect(isLibraryItemSteward(uid, livingItem, null, null, new Set([uid]))).toBe(true);
  });

  it("rejects a member who is not the uploader and not a steward", () => {
    expect(isLibraryItemSteward(uid, livingItem, memberMembership, null, noStewards)).toBe(false);
  });

  it("rejects a removed admin", () => {
    expect(
      isLibraryItemSteward(
        uid,
        livingItem,
        { ...adminMembership, removedAt: now },
        null,
        noStewards,
      ),
    ).toBe(false);
  });

  it("rejects a revoked operator", () => {
    expect(
      isLibraryItemSteward(
        uid,
        livingItem,
        null,
        { ...activeOperator, revokedAt: now, revokedBy: uid },
        noStewards,
      ),
    ).toBe(false);
  });
});

describe("canUploadLibraryItem", () => {
  it("allows any current member", () => {
    expect(canUploadLibraryItem(actor, activeGroup, memberMembership).ok).toBe(true);
  });

  it("denies non-members", () => {
    const result = canUploadLibraryItem(actor, activeGroup, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe("not_group_member");
  });

  it("denies removed members", () => {
    const result = canUploadLibraryItem(actor, activeGroup, removedMembership);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe("not_group_member");
  });

  it("denies on archived group", () => {
    const result = canUploadLibraryItem(actor, archivedGroup, adminMembership);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe("group_archived");
  });
});

describe("canAddLibraryRevision", () => {
  it("allows the uploader on a living item", () => {
    const result = canAddLibraryRevision(
      uploaderUid,
      activeGroup,
      livingItem,
      null,
      null,
      noStewards,
    );
    expect(result.ok).toBe(true);
  });

  it("allows an explicit steward", () => {
    const result = canAddLibraryRevision(
      otherUid,
      activeGroup,
      livingItem,
      null,
      null,
      new Set([otherUid]),
    );
    expect(result.ok).toBe(true);
  });

  it("denies on retired item", () => {
    const result = canAddLibraryRevision(
      uploaderUid,
      activeGroup,
      retiredItem,
      null,
      null,
      noStewards,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe("library_item_retired");
  });

  it("denies on archived group", () => {
    const result = canAddLibraryRevision(
      uploaderUid,
      archivedGroup,
      livingItem,
      null,
      null,
      noStewards,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe("group_archived");
  });

  it("denies a non-steward member", () => {
    const result = canAddLibraryRevision(
      uid,
      activeGroup,
      livingItem,
      memberMembership,
      null,
      noStewards,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe("not_library_steward");
  });
});

describe("canUpdateLibraryMetadata", () => {
  it("allows steward on a retired item (typo fix on history)", () => {
    const result = canUpdateLibraryMetadata(
      uploaderUid,
      activeGroup,
      retiredItem,
      null,
      null,
      noStewards,
    );
    expect(result.ok).toBe(true);
  });

  it("denies on archived group", () => {
    const result = canUpdateLibraryMetadata(
      uploaderUid,
      archivedGroup,
      livingItem,
      null,
      null,
      noStewards,
    );
    expect(result.ok).toBe(false);
  });

  it("denies a non-steward member", () => {
    const result = canUpdateLibraryMetadata(
      uid,
      activeGroup,
      livingItem,
      memberMembership,
      null,
      noStewards,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe("not_library_steward");
  });
});

describe("canRetireLibraryItem", () => {
  it("allows a steward", () => {
    const result = canRetireLibraryItem(
      uploaderUid,
      activeGroup,
      livingItem,
      null,
      null,
      noStewards,
    );
    expect(result.ok).toBe(true);
  });

  it("denies a non-steward", () => {
    const result = canRetireLibraryItem(
      uid,
      activeGroup,
      livingItem,
      memberMembership,
      null,
      noStewards,
    );
    expect(result.ok).toBe(false);
  });
});

describe("canAddLibraryStewards", () => {
  it("allows an existing steward", () => {
    const result = canAddLibraryStewards(
      uploaderUid,
      activeGroup,
      livingItem,
      null,
      null,
      noStewards,
    );
    expect(result.ok).toBe(true);
  });

  it("denies on archived group", () => {
    const result = canAddLibraryStewards(
      uploaderUid,
      archivedGroup,
      livingItem,
      null,
      null,
      noStewards,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe("group_archived");
  });

  it("denies a non-steward member", () => {
    const result = canAddLibraryStewards(
      uid,
      activeGroup,
      livingItem,
      memberMembership,
      null,
      noStewards,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe("not_library_steward");
  });
});

describe("canAttachLibraryItemToActivity", () => {
  it("allows attaching a living item", () => {
    expect(canAttachLibraryItemToActivity(livingItem).ok).toBe(true);
  });

  it("denies attaching a retired item", () => {
    const result = canAttachLibraryItemToActivity(retiredItem);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe("library_item_retired");
  });
});
