import { describe, expect, it, vi } from "vitest";
import { requestAvatarUpload } from "../src/use-cases/request-avatar-upload.ts";
import {
  ACTIVE_GROUP,
  ACTOR,
  ACTOR_ID,
  GROUP_ID,
  makeGroups,
  makeIds,
  makePolicy,
  makeStorage,
  makeUploads,
  makeUsers,
  membership,
  TEST_NOW,
} from "./_helpers.ts";

describe("requestAvatarUpload", () => {
  it("mints a presigned URL and writes a pending upload row", async () => {
    const presign = vi.fn(async () => ({
      url: "https://r2.example.com/avatars/u/g/k?sig",
      requiredHeaders: { "Content-Type": "image/png" },
    }));
    const createPending = vi.fn();
    const result = await requestAvatarUpload(
      {
        actor: ACTOR_ID,
        groupId: GROUP_ID,
        mimeType: "image/png",
        sizeBytes: 1000,
        now: TEST_NOW,
      },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        policy: makePolicy(),
        storage: makeStorage({ putUploadPresigned: presign }),
        uploads: makeUploads({ createPending }),
        ids: makeIds(["upload-id-1", "cuid-1"]),
      },
    );
    expect(result.upload.url).toMatch(/^https:\/\//);
    expect(result.key).toMatch(/^avatars\//);
    expect(presign).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "image/png", sizeBytes: 1000 }),
    );
    expect(createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        context: "avatar",
        declaredSizeBytes: 1000,
        declaredMimeType: "image/png",
      }),
    );
  });

  it("rejects an oversized avatar (>512 KB)", async () => {
    await expect(
      requestAvatarUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          mimeType: "image/png",
          sizeBytes: 600 * 1024,
          now: TEST_NOW,
        },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => membership()) }),
          policy: makePolicy(),
          storage: makeStorage(),
          uploads: makeUploads(),
          ids: makeIds(["a", "b"]),
        },
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION", reason: "invalid_avatar_size" });
  });

  it("rejects an unsupported MIME type", async () => {
    await expect(
      requestAvatarUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          mimeType: "image/gif" as "image/png",
          sizeBytes: 100,
          now: TEST_NOW,
        },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => membership()) }),
          policy: makePolicy(),
          storage: makeStorage(),
          uploads: makeUploads(),
          ids: makeIds(["a", "b"]),
        },
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION", reason: "invalid_avatar_mime" });
  });

  it("rejects a non-member actor (404 via canViewGroup)", async () => {
    await expect(
      requestAvatarUpload(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          mimeType: "image/png",
          sizeBytes: 100,
          now: TEST_NOW,
        },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => null) }),
          policy: makePolicy(),
          storage: makeStorage(),
          uploads: makeUploads(),
          ids: makeIds(["a", "b"]),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
