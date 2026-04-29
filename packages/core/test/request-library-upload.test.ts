import type { LibraryItem, LibraryItemId, LibraryRevisionId } from "@hearth/domain";
import { DomainError } from "@hearth/domain";
import { describe, expect, it, vi } from "vitest";
import { requestLibraryUpload } from "../src/use-cases/request-library-upload.ts";
import {
  ACTIVE_GROUP,
  ACTOR,
  ACTOR_ID,
  GROUP_ID,
  makeGroups,
  makeIds,
  makeLibrary,
  makePolicy,
  makeStorage,
  makeUploads,
  makeUsers,
  membership,
  TEST_NOW,
} from "./_helpers.ts";

const livingItem: LibraryItem = {
  id: "li_existing" as LibraryItemId,
  groupId: GROUP_ID,
  title: "Primer",
  description: null,
  tags: [],
  currentRevisionId: "lr_1" as LibraryRevisionId,
  uploadedBy: ACTOR_ID,
  retiredAt: null,
  retiredBy: null,
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
};

describe("requestLibraryUpload — new item", () => {
  it("returns a presigned URL and writes a pending row", async () => {
    const presign = vi.fn(async () => ({
      url: "https://r2.example.com/library/g/li/lr?sig",
      requiredHeaders: { "Content-Type": "application/pdf" },
    }));
    const createPending = vi.fn();
    const result = await requestLibraryUpload(
      {
        actor: ACTOR_ID,
        groupId: GROUP_ID,
        mimeType: "application/pdf",
        sizeBytes: 5_000_000,
        originalFilename: "primer.pdf",
        now: TEST_NOW,
      },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        policy: makePolicy(),
        library: makeLibrary(),
        storage: makeStorage({ putUploadPresigned: presign, usedBytes: vi.fn(async () => 0) }),
        uploads: makeUploads({ createPending }),
        ids: makeIds(["item-1", "rev-1", "upload-1"]),
      },
    );

    expect(result.uploadId).toBe("upload-1");
    expect(result.libraryItemId).toBe("item-1");
    expect(result.revisionId).toBe("rev-1");
    expect(result.key).toBe(`library/${GROUP_ID}/item-1/rev-1`);
    expect(result.byteQuotaRemaining).toBeGreaterThan(0);
    expect(presign).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "application/pdf", sizeBytes: 5_000_000 }),
    );
    expect(createPending).toHaveBeenCalledWith(
      expect.objectContaining({ context: "library", storageKey: result.key }),
    );
  });

  it("rejects oversized uploads", async () => {
    await expect(
      requestLibraryUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          mimeType: "application/pdf",
          sizeBytes: 200 * 1024 * 1024,
          originalFilename: null,
          now: TEST_NOW,
        },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups(),
          policy: makePolicy(),
          library: makeLibrary(),
          storage: makeStorage(),
          uploads: makeUploads(),
          ids: makeIds(["a", "b", "c"]),
        },
      ),
    ).rejects.toMatchObject({ reason: "invalid_size" });
  });

  it("rejects MIMEs not on the allowlist", async () => {
    await expect(
      requestLibraryUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          mimeType: "application/x-msdownload",
          sizeBytes: 1000,
          originalFilename: null,
          now: TEST_NOW,
        },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups(),
          policy: makePolicy(),
          library: makeLibrary(),
          storage: makeStorage(),
          uploads: makeUploads(),
          ids: makeIds(["a", "b", "c"]),
        },
      ),
    ).rejects.toMatchObject({ reason: "mime_not_allowed" });
  });

  it("denies an archived-group member with FORBIDDEN", async () => {
    await expect(
      requestLibraryUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          mimeType: "application/pdf",
          sizeBytes: 1000,
          originalFilename: null,
          now: TEST_NOW,
        },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ({
              ...ACTIVE_GROUP,
              status: "archived" as const,
              archivedAt: TEST_NOW,
            })),
            membership: vi.fn(async () => membership({ role: "admin" })),
          }),
          policy: makePolicy(),
          library: makeLibrary(),
          storage: makeStorage(),
          uploads: makeUploads(),
          ids: makeIds(["a", "b", "c"]),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "group_archived" });
  });

  it("denies non-members", async () => {
    await expect(
      requestLibraryUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          mimeType: "application/pdf",
          sizeBytes: 1000,
          originalFilename: null,
          now: TEST_NOW,
        },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ACTIVE_GROUP),
            membership: vi.fn(async () => null),
          }),
          policy: makePolicy(),
          library: makeLibrary(),
          storage: makeStorage(),
          uploads: makeUploads(),
          ids: makeIds(["a", "b", "c"]),
        },
      ),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("trips byte quota when projected usage crosses the threshold", async () => {
    const presign = vi.fn();
    const createPending = vi.fn();
    // Default INSTANCE_R2_BYTE_BUDGET = 10 GB; trip = 80% = 8 GB. Mock
    // usedBytes at 7.95 GB so a 100 MB upload would cross the line.
    const used = 7.95 * 1024 * 1024 * 1024;
    await expect(
      requestLibraryUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          mimeType: "application/pdf",
          sizeBytes: 90 * 1024 * 1024,
          originalFilename: null,
          now: TEST_NOW,
        },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ACTIVE_GROUP),
            membership: vi.fn(async () => membership({ role: "participant" })),
          }),
          policy: makePolicy(),
          library: makeLibrary(),
          storage: makeStorage({ usedBytes: vi.fn(async () => used) }),
          uploads: makeUploads({ createPending }),
          ids: makeIds(["a", "b", "c"]),
        },
      ),
    ).rejects.toMatchObject({ reason: "byte_quota_exceeded" });
    expect(presign).not.toHaveBeenCalled();
    expect(createPending).not.toHaveBeenCalled();
  });
});

describe("requestLibraryUpload — new revision", () => {
  it("allows the uploader to add a revision", async () => {
    const presign = vi.fn(async () => ({
      url: "https://r2.example.com/library/g/li/lr?sig",
      requiredHeaders: { "Content-Type": "application/pdf" },
    }));
    const result = await requestLibraryUpload(
      {
        actor: ACTOR_ID,
        groupId: GROUP_ID,
        mimeType: "application/pdf",
        sizeBytes: 1000,
        originalFilename: null,
        libraryItemId: livingItem.id,
        now: TEST_NOW,
      },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        policy: makePolicy(),
        library: makeLibrary({ byId: vi.fn(async () => livingItem) }),
        storage: makeStorage({ putUploadPresigned: presign, usedBytes: vi.fn(async () => 0) }),
        uploads: makeUploads(),
        ids: makeIds(["rev-id", "upload-id"]),
      },
    );
    expect(result.libraryItemId).toBe(livingItem.id);
    expect(result.revisionId).toBe("rev-id");
  });

  it("rejects revision uploads on retired items with a CONFLICT", async () => {
    await expect(
      requestLibraryUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          mimeType: "application/pdf",
          sizeBytes: 1000,
          originalFilename: null,
          libraryItemId: livingItem.id,
          now: TEST_NOW,
        },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ACTIVE_GROUP),
            membership: vi.fn(async () => membership({ role: "participant" })),
          }),
          policy: makePolicy(),
          library: makeLibrary({
            byId: vi.fn(async () => ({ ...livingItem, retiredAt: TEST_NOW })),
          }),
          storage: makeStorage(),
          uploads: makeUploads(),
          ids: makeIds(["a", "b"]),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "library_item_retired" });
  });

  it("rejects revision uploads from a non-steward member", async () => {
    const otherUploader = "u_other" as typeof ACTOR_ID;
    await expect(
      requestLibraryUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          mimeType: "application/pdf",
          sizeBytes: 1000,
          originalFilename: null,
          libraryItemId: livingItem.id,
          now: TEST_NOW,
        },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ACTIVE_GROUP),
            membership: vi.fn(async () => membership({ role: "participant" })),
          }),
          policy: makePolicy(),
          library: makeLibrary({
            byId: vi.fn(async () => ({ ...livingItem, uploadedBy: otherUploader })),
          }),
          storage: makeStorage(),
          uploads: makeUploads(),
          ids: makeIds(["a", "b"]),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects revisions when the item belongs to a different group", async () => {
    await expect(
      requestLibraryUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          mimeType: "application/pdf",
          sizeBytes: 1000,
          originalFilename: null,
          libraryItemId: livingItem.id,
          now: TEST_NOW,
        },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ACTIVE_GROUP),
            membership: vi.fn(async () => membership({ role: "participant" })),
          }),
          policy: makePolicy(),
          library: makeLibrary({
            byId: vi.fn(async () => ({ ...livingItem, groupId: "g_other" as typeof GROUP_ID })),
          }),
          storage: makeStorage(),
          uploads: makeUploads(),
          ids: makeIds(["a", "b"]),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
