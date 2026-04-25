import { describe, expect, it, vi } from "vitest";
import { finalizeAvatarUpload } from "../src/use-cases/finalize-avatar-upload.ts";
import {
  ACTIVE_GROUP,
  ACTOR,
  ACTOR_ID,
  GROUP_ID,
  makeGroups,
  makePolicy,
  makeStorage,
  makeUploads,
  makeUsers,
  membership,
  TEST_NOW,
} from "./_helpers.ts";

const PENDING_KEY = `avatars/${ACTOR_ID}/${GROUP_ID}/cuid-1`;

const pendingRow = {
  id: "upload-id-1",
  uploaderUserId: ACTOR_ID,
  groupId: GROUP_ID,
  context: "avatar" as const,
  storageKey: PENDING_KEY,
  declaredSizeBytes: 1234,
  declaredMimeType: "image/png",
  createdAt: TEST_NOW,
  expiresAt: new Date(TEST_NOW.getTime() + 900_000),
};

describe("finalizeAvatarUpload", () => {
  it("verifies headObject + size, writes the avatar URL, and drops the pending row", async () => {
    const updateProfile = vi.fn(async () => membership({ role: "participant" }));
    const headObject = vi.fn(async () => ({ size: 1234, uploadedAt: TEST_NOW }));
    const deletePending = vi.fn();
    await finalizeAvatarUpload(
      { actor: ACTOR_ID, uploadId: "upload-id-1" },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "participant" })),
          updateProfile,
        }),
        policy: makePolicy(),
        storage: makeStorage({ headObject }),
        uploads: makeUploads({
          getPending: vi.fn(async () => pendingRow),
          deletePending,
        }),
      },
    );
    expect(headObject).toHaveBeenCalledWith(PENDING_KEY);
    expect(updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ patch: { avatarUrl: PENDING_KEY } }),
    );
    expect(deletePending).toHaveBeenCalledWith("upload-id-1");
  });

  it("rejects when the pending row belongs to another user", async () => {
    await expect(
      finalizeAvatarUpload(
        { actor: ACTOR_ID, uploadId: "upload-id-1" },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups(),
          policy: makePolicy(),
          storage: makeStorage(),
          uploads: makeUploads({
            getPending: vi.fn(async () => ({
              ...pendingRow,
              uploaderUserId: "u_other" as typeof pendingRow.uploaderUserId,
            })),
          }),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", reason: "pending_upload_not_found" });
  });

  it("rejects when the R2 object is missing", async () => {
    await expect(
      finalizeAvatarUpload(
        { actor: ACTOR_ID, uploadId: "upload-id-1" },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups(),
          policy: makePolicy(),
          storage: makeStorage({ headObject: vi.fn(async () => null) }),
          uploads: makeUploads({ getPending: vi.fn(async () => pendingRow) }),
        },
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION", reason: "upload_missing" });
  });

  it("rejects on size mismatch and best-effort cleans up", async () => {
    const deletePending = vi.fn();
    const deleteKey = vi.fn();
    await expect(
      finalizeAvatarUpload(
        { actor: ACTOR_ID, uploadId: "upload-id-1" },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups(),
          policy: makePolicy(),
          storage: makeStorage({
            headObject: vi.fn(async () => ({ size: 9999, uploadedAt: TEST_NOW })),
            delete: deleteKey,
          }),
          uploads: makeUploads({
            getPending: vi.fn(async () => pendingRow),
            deletePending,
          }),
        },
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION", reason: "upload_size_mismatch" });
    expect(deleteKey).toHaveBeenCalledWith(PENDING_KEY);
    expect(deletePending).toHaveBeenCalledWith("upload-id-1");
  });
});
