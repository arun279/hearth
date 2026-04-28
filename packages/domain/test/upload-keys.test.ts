import { describe, expect, it } from "vitest";
import type { StudyGroupId, UserId } from "../src/ids.ts";
import {
  assertAvatarKey,
  assertLibraryKey,
  avatarKey,
  isAvatarKey,
  isLibraryKey,
  libraryGroupPrefix,
  libraryKey,
} from "../src/upload-keys.ts";

const uid = "u_abc12345" as UserId;
const gid = "g_xyz67890" as StudyGroupId;
const itemId = "li_revisionid";
const revId = "lr_revisionid";

describe("upload key validators", () => {
  it("isAvatarKey accepts the canonical avatar shape", () => {
    expect(isAvatarKey(`avatars/${uid}/${gid}/${itemId}`)).toBe(true);
  });

  it("isLibraryKey accepts the canonical library shape", () => {
    expect(isLibraryKey(`library/${gid}/${itemId}/${revId}`)).toBe(true);
  });

  it("isAvatarKey rejects a library-shaped key (CI rule 10)", () => {
    expect(isAvatarKey(`library/${gid}/${itemId}/${revId}`)).toBe(false);
  });

  it("isLibraryKey rejects an avatar-shaped key (CI rule 10)", () => {
    expect(isLibraryKey(`avatars/${uid}/${gid}/${itemId}`)).toBe(false);
  });

  it("isLibraryKey rejects two-segment library keys (forward-compat guard)", () => {
    expect(isLibraryKey(`library/${gid}/${itemId}`)).toBe(false);
  });

  it("isAvatarKey rejects empty / malformed inputs", () => {
    expect(isAvatarKey("")).toBe(false);
    expect(isAvatarKey("avatars//xx/yy")).toBe(false);
    expect(isAvatarKey(`avatars/${uid}/${gid}/${itemId}/extra`)).toBe(false);
    expect(isAvatarKey("AVATARS/abc/def/ghi")).toBe(false);
  });

  it("assertAvatarKey throws on bad keys, returns void on good ones", () => {
    expect(() => assertAvatarKey(`avatars/${uid}/${gid}/${itemId}`)).not.toThrow();
    expect(() => assertAvatarKey(`library/${gid}/${itemId}/${revId}`)).toThrow();
  });

  it("assertLibraryKey throws on bad keys, returns void on good ones", () => {
    expect(() => assertLibraryKey(`library/${gid}/${itemId}/${revId}`)).not.toThrow();
    expect(() => assertLibraryKey(`avatars/${uid}/${gid}/${itemId}`)).toThrow();
  });

  it("avatarKey constructs a valid key", () => {
    expect(avatarKey(uid, gid, itemId)).toBe(`avatars/${uid}/${gid}/${itemId}`);
  });

  it("libraryKey constructs a valid key", () => {
    expect(libraryKey(gid, itemId, revId)).toBe(`library/${gid}/${itemId}/${revId}`);
  });

  it("libraryGroupPrefix returns the per-group R2 prefix", () => {
    expect(libraryGroupPrefix(gid)).toBe(`library/${gid}/`);
  });
});
