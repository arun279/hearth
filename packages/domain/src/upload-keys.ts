import type { StudyGroupId, UserId } from "./ids.ts";

/**
 * Pure key-shape validators for direct-to-R2 uploads. Living in the domain
 * keeps them SPA-importable (CI rule 9) AND adapter-importable, so the
 * adapter and the use case can both refuse to mint URLs for a malformed
 * key without a circular import.
 *
 * Avatar key:  `avatars/{userId}/{groupId}/{cuid2}` — one R2 object per
 *              (user, group) profile slot.
 * Library key: `library/{groupId}/{itemId}/{revisionId}` — three segments
 *              after the prefix so a `bucket.list({ prefix: "library/<groupId>/" })`
 *              returns exactly one group's storage. The prefix is also
 *              what `usedBytes(prefix)` filters on for per-group quota.
 */
const SEGMENT = "[A-Za-z0-9_-]{1,64}";
const AVATAR_KEY_RE = new RegExp(`^avatars/${SEGMENT}/${SEGMENT}/${SEGMENT}$`);
const LIBRARY_KEY_RE = new RegExp(`^library/${SEGMENT}/${SEGMENT}/${SEGMENT}$`);

export function isAvatarKey(key: string): boolean {
  return AVATAR_KEY_RE.test(key);
}

export function isLibraryKey(key: string): boolean {
  return LIBRARY_KEY_RE.test(key);
}

export function assertAvatarKey(key: string): void {
  if (!isAvatarKey(key)) {
    throw new Error(`Refusing to mint URL for non-avatar key: ${key}`);
  }
}

export function assertLibraryKey(key: string): void {
  if (!isLibraryKey(key)) {
    throw new Error(`Refusing to mint URL for non-library key: ${key}`);
  }
}

export function avatarKey(userId: UserId, groupId: StudyGroupId, cuid: string): string {
  const key = `avatars/${userId}/${groupId}/${cuid}`;
  assertAvatarKey(key);
  return key;
}

export function libraryKey(groupId: StudyGroupId, itemId: string, revisionId: string): string {
  const key = `library/${groupId}/${itemId}/${revisionId}`;
  assertLibraryKey(key);
  return key;
}

/**
 * The R2 prefix that bounds one Study Group's library storage. `usedBytes`
 * walks this prefix to enforce the per-group byte budget without scanning
 * the full bucket.
 */
export function libraryGroupPrefix(groupId: StudyGroupId): string {
  return `library/${groupId}/`;
}
