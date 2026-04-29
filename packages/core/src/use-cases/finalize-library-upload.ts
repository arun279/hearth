import {
  DomainError,
  type LibraryItemId,
  type LibraryRevisionId,
  normalizeTags,
  type StudyGroupId,
  type UserId,
} from "@hearth/domain";
import { canAddLibraryRevision } from "@hearth/domain/policy/can-add-library-revision";
import { canUploadLibraryItem } from "@hearth/domain/policy/can-upload-library-item";
import type {
  InstanceAccessPolicyRepository,
  LibraryItemDetail,
  LibraryItemRepository,
  ObjectStorage,
  StudyGroupRepository,
  UploadCoordinationRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup } from "./_lib/load-viewable-group.ts";

export type FinalizeLibraryUploadInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
  readonly uploadId: string;
  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly now: Date;
};

export type FinalizeLibraryUploadDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
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
  if (pending.expiresAt.getTime() <= input.now.getTime()) {
    // The 15-min window closed; the cron sweep just hasn't reaped this row
    // yet. Drop the row + R2 object eagerly so the same uploadId resolves
    // as a normal 404 on any retry, and the orphan object can't ride the
    // bucket past the next sweep cycle.
    await Promise.allSettled([
      deps.storage.delete(pending.storageKey),
      deps.uploads.deletePending(input.uploadId),
    ]);
    throw new DomainError("GONE", "Upload window expired.", "upload_expired");
  }

  // Re-run the policy check now. The 15-min TTL is wide enough for a member
  // to be removed mid-window — without this re-check, a removed member can
  // still finalize the upload they had in flight when their membership ended.
  const { actor, group, membership } = await loadViewableGroup(input.actor, input.groupId, deps);

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

  if (existing === null) {
    const newItemVerdict = canUploadLibraryItem(actor, group, membership);
    if (!newItemVerdict.ok) {
      throw new DomainError("FORBIDDEN", newItemVerdict.reason.message, newItemVerdict.reason.code);
    }
  } else {
    if (existing.groupId !== pending.groupId) {
      // The request use case verified group ownership at presign time;
      // re-checking here protects against a row whose item moved between
      // request and finalize.
      throw new DomainError(
        "INVARIANT_VIOLATION",
        "Pending upload's group no longer matches the item's group.",
        "group_mismatch",
      );
    }
    const operator = await deps.policy.getOperator(input.actor);
    const stewards = await deps.library.listStewards(itemId);
    const stewardSet: ReadonlySet<UserId> = new Set(stewards.map((s) => s.userId));
    const revisionVerdict = canAddLibraryRevision(
      input.actor,
      group,
      existing,
      membership,
      operator,
      stewardSet,
    );
    if (!revisionVerdict.ok) {
      throw new DomainError(
        "FORBIDDEN",
        revisionVerdict.reason.message,
        revisionVerdict.reason.code,
      );
    }
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

  let detail: LibraryItemDetail;
  if (existing === null) {
    detail = await deps.library.create({
      id: itemId,
      groupId: pending.groupId,
      title: input.title,
      description: input.description,
      tags: normalizeTags(input.tags),
      uploadedBy: input.actor,
      firstRevision: {
        id: revisionId,
        storageKey: pending.storageKey,
        mimeType: pending.declaredMimeType,
        sizeBytes: pending.declaredSizeBytes,
        originalFilename: pending.originalFilename,
        uploadedBy: input.actor,
        uploadedAt: input.now,
      },
      now: input.now,
    });
  } else {
    try {
      await deps.library.addRevision({
        libraryItemId: itemId,
        revision: {
          id: revisionId,
          storageKey: pending.storageKey,
          mimeType: pending.declaredMimeType,
          sizeBytes: pending.declaredSizeBytes,
          originalFilename: pending.originalFilename,
          uploadedBy: input.actor,
          uploadedAt: input.now,
        },
      });
    } catch (err) {
      // The UNIQUE `(library_item_id, revision_number)` index is the
      // race guard. A concurrent finalize that picks the same number
      // trips it; map to 409 so the SPA can prompt the user to retry.
      if (isUniqueViolation(err)) {
        throw new DomainError(
          "CONFLICT",
          "Another revision was added concurrently — retry.",
          "revision_number_conflict",
        );
      }
      throw err;
    }
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

/**
 * D1 surfaces SQLite UNIQUE-violation errors as `Error` instances whose
 * message contains the constraint name. This matcher lives here rather
 * than in the adapter because the use case is the layer that owns the
 * error → DomainError mapping; the adapter intentionally throws raw so
 * the use case can decide whether the failure is recoverable.
 */
function isUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message;
  return (
    m.includes("UNIQUE constraint failed") ||
    m.includes("constraint: unique") ||
    m.includes("library_revisions_item_number_idx")
  );
}
