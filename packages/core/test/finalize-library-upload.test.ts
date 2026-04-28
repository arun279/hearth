import type {
  LibraryItem,
  LibraryItemId,
  LibraryRevision,
  LibraryRevisionId,
} from "@hearth/domain";
import type { LibraryItemDetail, PendingUpload } from "@hearth/ports";
import { describe, expect, it, vi } from "vitest";
import { finalizeLibraryUpload } from "../src/use-cases/finalize-library-upload.ts";
import { ACTOR_ID, GROUP_ID, makeLibrary, makeStorage, makeUploads, TEST_NOW } from "./_helpers.ts";

const itemId = "li_1" as LibraryItemId;
const revisionId = "lr_1" as LibraryRevisionId;
const storageKey = `library/${GROUP_ID}/${itemId}/${revisionId}`;

const pendingRow: PendingUpload = {
  id: "u_1",
  uploaderUserId: ACTOR_ID,
  groupId: GROUP_ID,
  context: "library",
  storageKey,
  declaredSizeBytes: 1000,
  declaredMimeType: "application/pdf",
  createdAt: TEST_NOW,
  expiresAt: new Date(TEST_NOW.getTime() + 900_000),
};

const newItem: LibraryItem = {
  id: itemId,
  groupId: GROUP_ID,
  title: "Primer",
  description: null,
  tags: [],
  currentRevisionId: revisionId,
  uploadedBy: ACTOR_ID,
  retiredAt: null,
  retiredBy: null,
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
};

const firstRevision: LibraryRevision = {
  id: revisionId,
  libraryItemId: itemId,
  revisionNumber: 1,
  storageKey,
  mimeType: "application/pdf",
  sizeBytes: 1000,
  originalFilename: null,
  uploadedBy: ACTOR_ID,
  uploadedAt: TEST_NOW,
};

const newDetail: LibraryItemDetail = {
  item: newItem,
  revisions: [firstRevision],
  stewards: [],
  usedInCount: 0,
};

describe("finalizeLibraryUpload", () => {
  it("creates a new item + first revision when the item id is fresh", async () => {
    const create = vi.fn(async () => newDetail);
    const deletePending = vi.fn();
    const result = await finalizeLibraryUpload(
      {
        actor: ACTOR_ID,
        groupId: GROUP_ID,
        uploadId: "u_1",
        title: "Primer",
        description: null,
        tags: [],
      },
      {
        library: makeLibrary({
          byId: vi.fn(async () => null),
          create,
        }),
        storage: makeStorage({
          headObject: vi.fn(async () => ({ size: 1000, uploadedAt: TEST_NOW })),
        }),
        uploads: makeUploads({ getPending: vi.fn(async () => pendingRow), deletePending }),
      },
    );
    expect(result.item.id).toBe(itemId);
    expect(create).toHaveBeenCalled();
    expect(deletePending).toHaveBeenCalledWith("u_1");
  });

  it("appends a revision when the item exists", async () => {
    const addRevision = vi.fn();
    const detail = vi.fn(async () => newDetail);
    const deletePending = vi.fn();
    const result = await finalizeLibraryUpload(
      {
        actor: ACTOR_ID,
        groupId: GROUP_ID,
        uploadId: "u_1",
        title: "ignored",
        description: null,
        tags: [],
      },
      {
        library: makeLibrary({
          byId: vi.fn(async () => newItem),
          addRevision,
          detail,
        }),
        storage: makeStorage({
          headObject: vi.fn(async () => ({ size: 1000, uploadedAt: TEST_NOW })),
        }),
        uploads: makeUploads({ getPending: vi.fn(async () => pendingRow), deletePending }),
      },
    );
    expect(result.item.id).toBe(itemId);
    expect(addRevision).toHaveBeenCalledWith(expect.objectContaining({ libraryItemId: itemId }));
    expect(deletePending).toHaveBeenCalledWith("u_1");
  });

  it("returns 404 when the pending row is missing", async () => {
    await expect(
      finalizeLibraryUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          uploadId: "u_missing",
          title: "Primer",
          description: null,
          tags: [],
        },
        {
          library: makeLibrary(),
          storage: makeStorage(),
          uploads: makeUploads({ getPending: vi.fn(async () => null) }),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", reason: "pending_upload_not_found" });
  });

  it("returns 404 when the actor doesn't own the pending row", async () => {
    await expect(
      finalizeLibraryUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          uploadId: "u_1",
          title: "Primer",
          description: null,
          tags: [],
        },
        {
          library: makeLibrary(),
          storage: makeStorage(),
          uploads: makeUploads({
            getPending: vi.fn(async () => ({
              ...pendingRow,
              uploaderUserId: "u_other" as typeof ACTOR_ID,
            })),
          }),
        },
      ),
    ).rejects.toMatchObject({ reason: "pending_upload_not_found" });
  });

  it("returns 422 + cleans up on size mismatch", async () => {
    const deleteR2 = vi.fn();
    const deletePending = vi.fn();
    await expect(
      finalizeLibraryUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          uploadId: "u_1",
          title: "Primer",
          description: null,
          tags: [],
        },
        {
          library: makeLibrary(),
          storage: makeStorage({
            headObject: vi.fn(async () => ({ size: 9999, uploadedAt: TEST_NOW })),
            delete: deleteR2,
          }),
          uploads: makeUploads({ getPending: vi.fn(async () => pendingRow), deletePending }),
        },
      ),
    ).rejects.toMatchObject({ reason: "size_mismatch" });
    expect(deleteR2).toHaveBeenCalledWith(storageKey);
    expect(deletePending).toHaveBeenCalledWith("u_1");
  });

  it("returns 422 when the R2 object never landed", async () => {
    await expect(
      finalizeLibraryUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          uploadId: "u_1",
          title: "Primer",
          description: null,
          tags: [],
        },
        {
          library: makeLibrary(),
          storage: makeStorage({ headObject: vi.fn(async () => null) }),
          uploads: makeUploads({ getPending: vi.fn(async () => pendingRow) }),
        },
      ),
    ).rejects.toMatchObject({ reason: "upload_missing" });
  });
});
