import type {
  LibraryItem,
  LibraryItemId,
  LibraryRevision,
  LibraryRevisionId,
} from "@hearth/domain";
import type { LibraryItemListEntry } from "@hearth/ports";
import { describe, expect, it, vi } from "vitest";
import { searchLibrary } from "../src/use-cases/search-library.ts";
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

const itemId = "li_search_1" as LibraryItemId;

const item: LibraryItem = {
  id: itemId,
  groupId: GROUP_ID,
  title: "Spanish primer",
  description: null,
  tags: ["spanish"],
  currentRevisionId: "lr_search_1" as LibraryRevisionId,
  uploadedBy: ACTOR_ID,
  retiredAt: null,
  retiredBy: null,
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
};

const revision: LibraryRevision = {
  id: "lr_search_1" as LibraryRevisionId,
  libraryItemId: itemId,
  revisionNumber: 1,
  storageKey: `library/${GROUP_ID}/${itemId}/lr_search_1`,
  mimeType: "application/pdf",
  sizeBytes: 1024,
  originalFilename: null,
  uploadedBy: ACTOR_ID,
  uploadedAt: TEST_NOW,
};

const entry: LibraryItemListEntry = {
  item,
  currentRevision: revision,
  stewardCount: 0,
  usedInCount: 0,
};

describe("searchLibrary", () => {
  it("returns the empty page when the query is below the minimum length, without touching the repository", async () => {
    const search = vi.fn();
    const result = await searchLibrary(
      { actor: ACTOR_ID, groupId: GROUP_ID, query: "a" },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        policy: makePolicy(),
        library: makeLibrary({ search }),
      },
    );
    expect(result).toEqual({ entries: [], nextCursor: null });
    expect(search).not.toHaveBeenCalled();
  });

  it("rejects with NOT_FOUND when the actor is not a current member (viewability)", async () => {
    await expect(
      searchLibrary(
        { actor: ACTOR_ID, groupId: GROUP_ID, query: "spanish" },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ACTIVE_GROUP),
            membership: vi.fn(async () => null),
          }),
          policy: makePolicy(),
          library: makeLibrary(),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("forwards the normalized FTS5 expression and projects displayKind from the current revision", async () => {
    const search = vi.fn(async () => ({ entries: [entry], nextCursor: "cursor_2" }));
    const result = await searchLibrary(
      { actor: ACTOR_ID, groupId: GROUP_ID, query: "  Spanish  ", limit: 10 },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        policy: makePolicy(),
        library: makeLibrary({ search }),
      },
    );
    expect(search).toHaveBeenCalledWith(GROUP_ID, {
      query: '"spanish"',
      limit: 10,
      cursor: null,
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.displayKind).toBe("pdf");
    expect(result.nextCursor).toBe("cursor_2");
  });

  it("clamps an out-of-range limit", async () => {
    const search = vi.fn(async () => ({ entries: [], nextCursor: null }));
    await searchLibrary(
      { actor: ACTOR_ID, groupId: GROUP_ID, query: "spanish", limit: 9999 },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        policy: makePolicy(),
        library: makeLibrary({ search }),
      },
    );
    expect(search).toHaveBeenCalledWith(GROUP_ID, expect.objectContaining({ limit: 100 }));
  });
});
