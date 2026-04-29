import type {
  LibraryItem,
  LibraryItemId,
  LibraryRevision,
  LibraryRevisionId,
} from "@hearth/domain";
import type { LibraryItemDetail, LibraryItemListEntry } from "@hearth/ports";
import { describe, expect, it, vi } from "vitest";
import { getLibraryItem } from "../src/use-cases/get-library-item.ts";
import { listLibraryItems } from "../src/use-cases/list-library-items.ts";
import {
  ACTIVE_GROUP,
  ACTOR,
  ACTOR_ID,
  GROUP_ID,
  makeGroups,
  makeLibrary,
  makePolicy,
  makeUsers,
  membership,
  TEST_NOW,
} from "./_helpers.ts";

const itemId = "li_1" as LibraryItemId;
const otherUid = "u_other" as typeof ACTOR_ID;

const livingItem: LibraryItem = {
  id: itemId,
  groupId: GROUP_ID,
  title: "Primer",
  description: null,
  tags: [],
  currentRevisionId: "lr_1" as LibraryRevisionId,
  uploadedBy: otherUid,
  retiredAt: null,
  retiredBy: null,
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
};

const revisions: LibraryRevision[] = [
  {
    id: "lr_1" as LibraryRevisionId,
    libraryItemId: itemId,
    revisionNumber: 1,
    storageKey: `library/${GROUP_ID}/${itemId}/lr_1`,
    mimeType: "application/pdf",
    sizeBytes: 1000,
    originalFilename: null,
    uploadedBy: otherUid,
    uploadedAt: TEST_NOW,
  },
];

const detail: LibraryItemDetail = {
  item: livingItem,
  revisions,
  stewards: [],
  usedInCount: 0,
};

describe("getLibraryItem", () => {
  it("projects steward caps for the uploader", async () => {
    const result = await getLibraryItem(
      { actor: otherUid, itemId },
      {
        users: makeUsers({ ...ACTOR, id: otherUid }),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ userId: otherUid, role: "participant" })),
        }),
        policy: makePolicy(),
        library: makeLibrary({
          byId: vi.fn(async () => livingItem),
          listStewards: vi.fn(async () => []),
          detail: vi.fn(async () => detail),
        }),
      },
    );
    expect(result.caps.canAddRevision).toBe(true);
    expect(result.caps.canRetire).toBe(true);
    expect(result.caps.canUpdateMetadata).toBe(true);
    expect(result.caps.canManageStewards).toBe(true);
    expect(result.displayKind).toBe("pdf");
  });

  it("throws when detail disappears between viewability and detail", async () => {
    await expect(
      getLibraryItem(
        { actor: ACTOR_ID, itemId },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ACTIVE_GROUP),
            membership: vi.fn(async () => membership({ role: "participant" })),
          }),
          policy: makePolicy(),
          library: makeLibrary({
            byId: vi.fn(async () => livingItem),
            listStewards: vi.fn(async () => []),
            detail: vi.fn(async () => null),
          }),
        },
      ),
    ).rejects.toThrow();
  });

  it("denies steward caps for a plain participant", async () => {
    const result = await getLibraryItem(
      { actor: ACTOR_ID, itemId },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        policy: makePolicy(),
        library: makeLibrary({
          byId: vi.fn(async () => livingItem),
          listStewards: vi.fn(async () => []),
          detail: vi.fn(async () => detail),
        }),
      },
    );
    expect(result.caps.canAddRevision).toBe(false);
    expect(result.caps.canRetire).toBe(false);
    expect(result.caps.canUpdateMetadata).toBe(false);
    expect(result.caps.canManageStewards).toBe(false);
  });
});

describe("listLibraryItems", () => {
  it("returns the byGroup payload + canUpload cap", async () => {
    const entries: LibraryItemListEntry[] = [
      { item: livingItem, currentRevision: revisions[0] ?? null, stewardCount: 0, usedInCount: 0 },
    ];
    const result = await listLibraryItems(
      { actor: ACTOR_ID, groupId: GROUP_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        policy: makePolicy(),
        library: makeLibrary({ byGroup: vi.fn(async () => entries) }),
      },
    );
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.displayKind).toBe("pdf");
    expect(result.caps.canUpload).toBe(true);
  });

  it("falls back to displayKind 'other' when currentRevision is null", async () => {
    const entries: LibraryItemListEntry[] = [
      { item: livingItem, currentRevision: null, stewardCount: 0, usedInCount: 0 },
    ];
    const result = await listLibraryItems(
      { actor: ACTOR_ID, groupId: GROUP_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        policy: makePolicy(),
        library: makeLibrary({ byGroup: vi.fn(async () => entries) }),
      },
    );
    expect(result.entries[0]?.displayKind).toBe("other");
  });
});
