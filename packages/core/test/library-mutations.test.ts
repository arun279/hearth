import type {
  LibraryItem,
  LibraryItemId,
  LibraryRevision,
  LibraryRevisionId,
  LibraryStewardship,
} from "@hearth/domain";
import type { LibraryItemDetail } from "@hearth/ports";
import { describe, expect, it, vi } from "vitest";
import { addLibrarySteward } from "../src/use-cases/add-library-steward.ts";
import { removeLibrarySteward } from "../src/use-cases/remove-library-steward.ts";
import { retireLibraryItem } from "../src/use-cases/retire-library-item.ts";
import { updateLibraryMetadata } from "../src/use-cases/update-library-metadata.ts";
import {
  ACTIVE_GROUP,
  ACTOR,
  ACTOR_ID,
  ARCHIVED_GROUP,
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
  description: "old",
  tags: ["draft"],
  currentRevisionId: "lr_1" as LibraryRevisionId,
  uploadedBy: ACTOR_ID,
  retiredAt: null,
  retiredBy: null,
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
};

const itemDetail: LibraryItemDetail = {
  item: livingItem,
  revisions: [
    {
      id: "lr_1" as LibraryRevisionId,
      libraryItemId: itemId,
      revisionNumber: 1,
      storageKey: `library/${GROUP_ID}/${itemId}/lr_1`,
      mimeType: "application/pdf",
      sizeBytes: 1000,
      originalFilename: null,
      uploadedBy: ACTOR_ID,
      uploadedAt: TEST_NOW,
    } satisfies LibraryRevision,
  ],
  stewards: [],
  usedInCount: 0,
};

describe("updateLibraryMetadata", () => {
  it("normalizes tags and updates the row", async () => {
    const updateMetadata = vi.fn(async () => ({ ...livingItem, tags: ["spanish"] }));
    await updateLibraryMetadata(
      {
        actor: ACTOR_ID,
        itemId,
        title: "  New title  ",
        description: "Updated",
        tags: ["Spanish", " spanish ", "GRAMMAR"],
      },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        policy: makePolicy(),
        library: makeLibrary({ byId: vi.fn(async () => livingItem), updateMetadata }),
      },
    );
    expect(updateMetadata).toHaveBeenCalledWith(
      itemId,
      expect.objectContaining({ title: "New title", tags: ["spanish", "grammar"] }),
    );
  });

  it("forbids updates from a non-steward", async () => {
    await expect(
      updateLibraryMetadata(
        { actor: ACTOR_ID, itemId, title: "x" },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ACTIVE_GROUP),
            membership: vi.fn(async () => membership({ role: "participant" })),
          }),
          policy: makePolicy(),
          library: makeLibrary({
            byId: vi.fn(async () => ({ ...livingItem, uploadedBy: otherUid })),
          }),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("forbids updates on archived groups", async () => {
    await expect(
      updateLibraryMetadata(
        { actor: ACTOR_ID, itemId, title: "x" },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ARCHIVED_GROUP),
            membership: vi.fn(async () => membership({ role: "admin" })),
          }),
          policy: makePolicy(),
          library: makeLibrary({ byId: vi.fn(async () => livingItem) }),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "group_archived" });
  });
});

describe("retireLibraryItem", () => {
  it("retires a living item via the steward path", async () => {
    const markRetired = vi.fn(async () => ({
      ...livingItem,
      retiredAt: TEST_NOW,
      retiredBy: ACTOR_ID,
    }));
    const result = await retireLibraryItem(
      { actor: ACTOR_ID, itemId, now: TEST_NOW },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        policy: makePolicy(),
        library: makeLibrary({ byId: vi.fn(async () => livingItem), markRetired }),
      },
    );
    expect(result.retiredAt).toEqual(TEST_NOW);
    expect(markRetired).toHaveBeenCalledWith(itemId, ACTOR_ID, TEST_NOW);
  });

  it("forbids retire from a non-steward", async () => {
    await expect(
      retireLibraryItem(
        { actor: ACTOR_ID, itemId, now: TEST_NOW },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ACTIVE_GROUP),
            membership: vi.fn(async () => membership({ role: "participant" })),
          }),
          policy: makePolicy(),
          library: makeLibrary({
            byId: vi.fn(async () => ({ ...livingItem, uploadedBy: otherUid })),
          }),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("addLibrarySteward", () => {
  it("returns null when promoting the implicit-uploader steward", async () => {
    const addSteward = vi.fn();
    const result = await addLibrarySteward(
      { actor: ACTOR_ID, itemId, userId: ACTOR_ID, now: TEST_NOW },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        policy: makePolicy(),
        library: makeLibrary({ byId: vi.fn(async () => livingItem), addSteward }),
      },
    );
    expect(result).toBeNull();
    expect(addSteward).not.toHaveBeenCalled();
  });

  it("inserts a row for a different member", async () => {
    const stewardship: LibraryStewardship = {
      id: "s_1",
      libraryItemId: itemId,
      userId: otherUid,
      grantedAt: TEST_NOW,
      grantedBy: ACTOR_ID,
    };
    const addSteward = vi.fn(async () => stewardship);
    const result = await addLibrarySteward(
      { actor: ACTOR_ID, itemId, userId: otherUid, now: TEST_NOW },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          // First call: actor (loadViewableGroup). Second call: target's
          // membership check inside addLibrarySteward. Both return current
          // member rows.
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        policy: makePolicy(),
        library: makeLibrary({ byId: vi.fn(async () => livingItem), addSteward }),
      },
    );
    expect(result).toEqual(stewardship);
  });

  it("rejects promoting a non-member", async () => {
    await expect(
      addLibrarySteward(
        { actor: ACTOR_ID, itemId, userId: otherUid, now: TEST_NOW },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ACTIVE_GROUP),
            membership: vi
              .fn()
              // First call (actor): current member.
              .mockResolvedValueOnce(membership({ role: "participant" }))
              // Second call (target): not a member.
              .mockResolvedValueOnce(null),
          }),
          policy: makePolicy(),
          library: makeLibrary({ byId: vi.fn(async () => livingItem) }),
        },
      ),
    ).rejects.toMatchObject({ reason: "target_not_member" });
  });
});

describe("removeLibrarySteward", () => {
  it("refuses to remove the original uploader", async () => {
    await expect(
      removeLibrarySteward(
        { actor: ACTOR_ID, itemId, userId: ACTOR_ID },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ACTIVE_GROUP),
            membership: vi.fn(async () => membership({ role: "participant" })),
          }),
          policy: makePolicy(),
          library: makeLibrary({ byId: vi.fn(async () => livingItem) }),
        },
      ),
    ).rejects.toMatchObject({ reason: "cannot_remove_uploader" });
  });

  it("removes a non-uploader steward", async () => {
    const removeSteward = vi.fn();
    await removeLibrarySteward(
      { actor: ACTOR_ID, itemId, userId: otherUid },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        policy: makePolicy(),
        library: makeLibrary({ byId: vi.fn(async () => livingItem), removeSteward }),
      },
    );
    expect(removeSteward).toHaveBeenCalledWith({ libraryItemId: itemId, userId: otherUid });
  });
});

void itemDetail;
