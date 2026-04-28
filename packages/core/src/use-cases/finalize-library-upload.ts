import {
  DomainError,
  type LibraryItemId,
  type LibraryRevisionId,
  type StudyGroupId,
  type UserId,
} from "@hearth/domain";
import type {
  LibraryItemDetail,
  LibraryItemRepository,
  ObjectStorage,
  UploadCoordinationRepository,
} from "@hearth/ports";

export type FinalizeLibraryUploadInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
  readonly uploadId: string;
  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];
};

export type FinalizeLibraryUploadDeps = {
  readonly library: LibraryItemRepository;
  readonly storage: ObjectStorage;
  readonly uploads: UploadCoordinationRepository;
};

/**
 * Finalize a library upload after the client's PUT lands. Failure modes:
 *
 * - `pending_upload_not_found` (404) — uploadId unknown, owned by a
 *   different actor, bound to a different group, or not the library
 *   context. We refuse to finalize anyone else's pending row.
 * - `upload_expired` (410) — the pending row exists but the cron sweep
 *   already retired it. The R2 key is best-effort deleted; the row was
 *   already gone. Caller restarts.
 * - `upload_missing` (422) — the R2 head call returned null. The client
 *   never completed the PUT. Pending row is retained so the cron sweep
 *   reaps it; the client retries the PUT against the same upload.
 * - `size_mismatch` (422) — the R2 object size differs from what was
 *   declared at request time. We delete the suspect object + the
 *   pending row so the user can retry cleanly.
 *
 * On success a single domain operation runs:
 *  - For a NEW item: `library.create()` materializes the item + first
 *    revision in one D1 batch.
 *  - For a NEW revision: `library.addRevision()` appends + bumps
 *    `currentRevisionId` in one D1 batch.
 * The pending row is dropped only on the success path so a transient
 * downstream failure leaves the row for the cron sweep to retire.
 */
export async function finalizeLibraryUpload(
  input: FinalizeLibraryUploadInput,
  deps: FinalizeLibraryUploadDeps,
): Promise<LibraryItemDetail> {
  const pending = await deps.uploads.getPending(input.uploadId);
  if (
    !pending ||
    pending.uploaderUserId !== input.actor ||
    pending.context !== "library" ||
    pending.groupId !== input.groupId
  ) {
    throw new DomainError("NOT_FOUND", "Pending upload not found.", "pending_upload_not_found");
  }

  const head = await deps.storage.headObject(pending.storageKey);
  if (!head) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      "Upload did not complete — no object at the expected key.",
      "upload_missing",
    );
  }
  if (head.size !== pending.declaredSizeBytes) {
    await Promise.allSettled([
      deps.storage.delete(pending.storageKey),
      deps.uploads.deletePending(input.uploadId),
    ]);
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Uploaded size (${head.size}) does not match the declared size (${pending.declaredSizeBytes}).`,
      "size_mismatch",
    );
  }

  // The storage key encodes both the item id and the revision id so
  // finalize can recover them without storing redundant columns on
  // pending_uploads. Shape: `library/{groupId}/{itemId}/{revisionId}`.
  const segments = pending.storageKey.split("/");
  if (segments.length !== 4 || segments[0] !== "library") {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      "Pending upload has a malformed storage key.",
      "malformed_storage_key",
    );
  }
  const itemId = segments[2] as LibraryItemId;
  const revisionId = segments[3] as LibraryRevisionId;

  const existing = await deps.library.byId(itemId);
  let detail: LibraryItemDetail;
  if (existing === null) {
    detail = await deps.library.create({
      id: itemId,
      groupId: pending.groupId,
      title: input.title,
      description: input.description,
      tags: input.tags,
      uploadedBy: input.actor,
      firstRevision: {
        id: revisionId,
        storageKey: pending.storageKey,
        mimeType: pending.declaredMimeType,
        sizeBytes: pending.declaredSizeBytes,
        originalFilename: null,
        uploadedBy: input.actor,
        uploadedAt: new Date(),
      },
      now: new Date(),
    });
  } else {
    if (existing.groupId !== pending.groupId) {
      // Defense in depth — the request use case verified group ownership
      // when the pending row was minted; re-checking here protects against
      // a row whose item moved between request and finalize.
      throw new DomainError(
        "INVARIANT_VIOLATION",
        "Pending upload's group no longer matches the item's group.",
        "group_mismatch",
      );
    }
    await deps.library.addRevision({
      libraryItemId: itemId,
      revision: {
        id: revisionId,
        storageKey: pending.storageKey,
        mimeType: pending.declaredMimeType,
        sizeBytes: pending.declaredSizeBytes,
        originalFilename: null,
        uploadedBy: input.actor,
        uploadedAt: new Date(),
      },
    });
    // Re-load the full detail so the caller (and the SPA's optimistic
    // cache) sees revisions/stewards/usedInCount in lockstep.
    const reloaded = await deps.library.detail(itemId);
    if (!reloaded) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        "Library item disappeared between addRevision and detail.",
        "library_item_disappeared",
      );
    }
    detail = reloaded;
  }

  await deps.uploads.deletePending(input.uploadId);
  return detail;
}
