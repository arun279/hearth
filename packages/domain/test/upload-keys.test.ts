import { describe, expect, it } from "vitest";
import type { StudyGroupId, UserId } from "../src/ids.ts";
import {
  assertAvatarKey,
  assertLibraryKey,
  avatarKey,
  isAvatarKey,
  isLibraryKey,
  libraryKey,
} from "../src/upload-keys.ts";

const uid = "u_abc12345" as UserId;
const gid = "g_xyz67890" as StudyGroupId;
const cuid = "k_revisionid";

describe("upload key validators", () => {
  it("isAvatarKey accepts the canonical avatar shape", () => {
    expect(isAvatarKey(`avatars/${uid}/${gid}/${cuid}`)).toBe(true);
  });

  it("isLibraryKey accepts the canonical library shape", () => {
    expect(isLibraryKey(`library/${gid}/${cuid}`)).toBe(true);
  });

  it("isAvatarKey rejects a library-shaped key (CI rule 10)", () => {
    expect(isAvatarKey(`library/${gid}/${cuid}`)).toBe(false);
  });

  it("isLibraryKey rejects an avatar-shaped key (CI rule 10)", () => {
    expect(isLibraryKey(`avatars/${uid}/${gid}/${cuid}`)).toBe(false);
  });

  it("isAvatarKey rejects empty / malformed inputs", () => {
    expect(isAvatarKey("")).toBe(false);
    expect(isAvatarKey("avatars//xx/yy")).toBe(false);
    expect(isAvatarKey(`avatars/${uid}/${gid}/${cuid}/extra`)).toBe(false);
    expect(isAvatarKey("AVATARS/abc/def/ghi")).toBe(false);
  });

  it("assertAvatarKey throws on bad keys, returns void on good ones", () => {
    expect(() => assertAvatarKey(`avatars/${uid}/${gid}/${cuid}`)).not.toThrow();
    expect(() => assertAvatarKey(`library/${gid}/${cuid}`)).toThrow();
  });

  it("assertLibraryKey throws on bad keys, returns void on good ones", () => {
    expect(() => assertLibraryKey(`library/${gid}/${cuid}`)).not.toThrow();
    expect(() => assertLibraryKey(`avatars/${uid}/${gid}/${cuid}`)).toThrow();
  });

  it("avatarKey constructs a valid key", () => {
    expect(avatarKey(uid, gid, cuid)).toBe(`avatars/${uid}/${gid}/${cuid}`);
  });

  it("libraryKey constructs a valid key", () => {
    expect(libraryKey(gid, cuid)).toBe(`library/${gid}/${cuid}`);
  });
});
