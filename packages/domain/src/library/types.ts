import type { LibraryItemId, LibraryRevisionId, StudyGroupId, UserId } from "../ids.ts";

/**
 * A Library Item is the logical handle the group hangs onto a piece of
 * shared material across revisions. The item is the stable identity (URL,
 * activity references, "used in N activities") and the body lives in
 * Library Revisions — uploads stack as immutable revisions so a steward
 * can fix a typo in v3 without invalidating someone's progress against v2.
 *
 * `currentRevisionId` is the row activities pin against by default. When a
 * Library Item has zero revisions (a brief window during the four-step
 * upload flow's failure modes) the field stays null and the SPA hides
 * "download current" affordances.
 *
 * `retiredAt` is a soft-stop: a retired item cannot be referenced by NEW
 * activities, but every existing reference keeps reading the pinned
 * revision so historical work doesn't break.
 */
export type LibraryItem = {
  readonly id: LibraryItemId;
  readonly groupId: StudyGroupId;
  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly currentRevisionId: LibraryRevisionId | null;
  readonly uploadedBy: UserId;
  readonly retiredAt: Date | null;
  readonly retiredBy: UserId | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type LibraryRevision = {
  readonly id: LibraryRevisionId;
  readonly libraryItemId: LibraryItemId;
  readonly revisionNumber: number;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly originalFilename: string | null;
  readonly uploadedBy: UserId;
  readonly uploadedAt: Date;
};

/**
 * A Steward is a Group Member who may edit / retire / curate a specific
 * Library Item. The original uploader is an implicit Steward — they don't
 * appear as a row but every steward predicate accepts them. Adding extra
 * Stewards lets a curator share authority without giving the recipient
 * Group Admin powers.
 */
export type LibraryStewardship = {
  readonly id: string;
  readonly libraryItemId: LibraryItemId;
  readonly userId: UserId;
  readonly grantedAt: Date;
  readonly grantedBy: UserId;
};

/**
 * The kind of media the SPA renders for the item. Derived purely from
 * the current revision's MIME type so we never need a schema migration to
 * add a new file type — the policy decides what's allowed and the
 * projection decides how it's displayed.
 */
export type LibraryDisplayKind = "pdf" | "audio" | "video" | "image" | "doc" | "other";
