import type { StudyGroupId, UserId } from "./ids.ts";

/**
 * Pure key-shape validators for direct-to-R2 uploads. Living in the domain
 * keeps them SPA-importable (CI rule 9) AND adapter-importable, so the
 * adapter and the use case can both refuse to mint URLs for a malformed
 * key without a circular import.
 *
 * Avatar key: `avatars/{userId}/{groupId}/{cuid2}` — one R2 object per
 * (user, group) profile slot.
 * Library key: `library/{itemId}/{revisionId}` — one object per revision.
 */
// Segments allow letters, digits, underscores, and hyphens — covers cuid2
// (lowercase alphanumeric, 24 chars), brand-prefixed test ids like
// `u_actor`/`g_xyz67890`, and the conservative subset of URL-safe characters.
// `+`, `/`, `.`, `=` are excluded so a malformed key can never collide with
// the prefix-discriminator path segment.
const AVATAR_KEY_RE = /^avatars\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/;
const LIBRARY_KEY_RE = /^library\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/;

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

export function libraryKey(itemId: string, revisionId: string): string {
  const key = `library/${itemId}/${revisionId}`;
  assertLibraryKey(key);
  return key;
}
