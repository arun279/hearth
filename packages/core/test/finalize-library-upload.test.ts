import type {
  LibraryItem,
  LibraryItemId,
  LibraryRevision,
  LibraryRevisionId,
} from "@hearth/domain";
import type { LibraryItemDetail, PendingUpload } from "@hearth/ports";
import { describe, expect, it, vi } from "vitest";
import { finalizeLibraryUpload } from "../src/use-cases/finalize-library-upload.ts";
import {
  ACTIVE_GROUP,
  ACTOR,
  ACTOR_ID,
  ARCHIVED_GROUP,
  GROUP_ID,
  makeGroups,
  makeLibrary,
  makePolicy,
  makeStorage,
  makeUploads,
  makeUsers,
  membership,
  TEST_NOW,
} from "./_helpers.ts";

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
  originalFilename: "primer.pdf",
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
  originalFilename: "primer.pdf",
  uploadedBy: ACTOR_ID,
  uploadedAt: TEST_NOW,
};

const newDetail: LibraryItemDetail = {
  item: newItem,
  revisions: [firstRevision],
  stewards: [],
  usedInCount: 0,
};

function defaultDeps() {
  return {
    users: makeUsers(ACTOR),
    groups: makeGroups({
      byId: vi.fn(async () => ACTIVE_GROUP),
      membership: vi.fn(async () => membership({ role: "participant" })),
    }),
    policy: makePolicy(),
  };
}

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
        now: TEST_NOW,
      },
      {
        ...defaultDeps(),
        library: makeLibrary({ byId: vi.fn(async () => null), create }),
        storage: makeStorage({
          headObject: vi.fn(async () => ({ size: 1000, uploadedAt: TEST_NOW })),
        }),
        uploads: makeUploads({ getPending: vi.fn(async () => pendingRow), deletePending }),
      },
    );
    expect(result.item.id).toBe(itemId);
    expect(create).toHaveBeenCalled();
    // Tag normalization runs at finalize for new items.
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ tags: [] }));
    // originalFilename flows from pending row → first revision.
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        firstRevision: expect.objectContaining({ originalFilename: "primer.pdf" }),
      }),
    );
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
        now: TEST_NOW,
      },
      {
        ...defaultDeps(),
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
          now: TEST_NOW,
        },
        {
          ...defaultDeps(),
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
          now: TEST_NOW,
        },
        {
          ...defaultDeps(),
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

  it("returns 410 + cleans up when the pending row has expired", async () => {
    const deleteR2 = vi.fn();
    const deletePending = vi.fn();
    const expired: PendingUpload = {
      ...pendingRow,
      expiresAt: new Date(TEST_NOW.getTime() - 1),
    };
    await expect(
      finalizeLibraryUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          uploadId: "u_1",
          title: "Primer",
          description: null,
          tags: [],
          now: TEST_NOW,
        },
        {
          ...defaultDeps(),
          library: makeLibrary(),
          storage: makeStorage({ delete: deleteR2 }),
          uploads: makeUploads({ getPending: vi.fn(async () => expired), deletePending }),
        },
      ),
    ).rejects.toMatchObject({ code: "GONE", reason: "upload_expired" });
    expect(deleteR2).toHaveBeenCalledWith(storageKey);
    expect(deletePending).toHaveBeenCalledWith("u_1");
  });

  it("re-runs the policy check after the pending TTL — removed members can't finalize", async () => {
    await expect(
      finalizeLibraryUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          uploadId: "u_1",
          title: "Primer",
          description: null,
          tags: [],
          now: TEST_NOW,
        },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ACTIVE_GROUP),
            membership: vi.fn(async () => null),
          }),
          policy: makePolicy(),
          library: makeLibrary({ byId: vi.fn(async () => null) }),
          storage: makeStorage(),
          uploads: makeUploads({ getPending: vi.fn(async () => pendingRow) }),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
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
          now: TEST_NOW,
        },
        {
          ...defaultDeps(),
          library: makeLibrary({ byId: vi.fn(async () => null) }),
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
          now: TEST_NOW,
        },
        {
          ...defaultDeps(),
          library: makeLibrary({ byId: vi.fn(async () => null) }),
          storage: makeStorage({ headObject: vi.fn(async () => null) }),
          uploads: makeUploads({ getPending: vi.fn(async () => pendingRow) }),
        },
      ),
    ).rejects.toMatchObject({ reason: "upload_missing" });
  });

  it("returns 403 when an existing item exists but the actor can no longer add revisions", async () => {
    // Group archived between presign and finalize → addRevision policy
    // re-check rejects the actor with FORBIDDEN.
    await expect(
      finalizeLibraryUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          uploadId: "u_1",
          title: "Primer",
          description: null,
          tags: [],
          now: TEST_NOW,
        },
        {
          ...defaultDeps(),
          groups: makeGroups({
            byId: vi.fn(async () => ARCHIVED_GROUP),
            membership: vi.fn(async () => membership({ role: "participant" })),
          }),
          library: makeLibrary({ byId: vi.fn(async () => newItem) }),
          storage: makeStorage(),
          uploads: makeUploads({ getPending: vi.fn(async () => pendingRow) }),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("re-throws non-UNIQUE addRevision errors so the caller sees the cause", async () => {
    // Anything other than the SQLite UNIQUE-constraint shape isn't ours
    // to translate — we propagate so the API envelope can map it via
    // the unknown-error path.
    const bang = new Error("transient db connection");
    await expect(
      finalizeLibraryUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          uploadId: "u_1",
          title: "Primer",
          description: null,
          tags: [],
          now: TEST_NOW,
        },
        {
          ...defaultDeps(),
          library: makeLibrary({
            byId: vi.fn(async () => newItem),
            addRevision: vi.fn(async () => {
              throw bang;
            }),
          }),
          storage: makeStorage({
            headObject: vi.fn(async () => ({ size: 1000, uploadedAt: TEST_NOW })),
          }),
          uploads: makeUploads({ getPending: vi.fn(async () => pendingRow) }),
        },
      ),
    ).rejects.toBe(bang);
  });

  it("maps SQLite UNIQUE constraint failures to 409 revision_number_conflict", async () => {
    const addRevision = vi.fn(async () => {
      throw new Error("D1_ERROR: UNIQUE constraint failed: library_revisions.revision_number");
    });
    await expect(
      finalizeLibraryUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          uploadId: "u_1",
          title: "Primer",
          description: null,
          tags: [],
          now: TEST_NOW,
        },
        {
          ...defaultDeps(),
          library: makeLibrary({ byId: vi.fn(async () => newItem), addRevision }),
          storage: makeStorage({
            headObject: vi.fn(async () => ({ size: 1000, uploadedAt: TEST_NOW })),
          }),
          uploads: makeUploads({ getPending: vi.fn(async () => pendingRow) }),
        },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", reason: "revision_number_conflict" });
  });
});
