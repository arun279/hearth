import type { StudyGroupId, UserId } from "@hearth/domain";

export type UploadContext = "avatar" | "library" | "pending_contribution";

export type PendingUpload = {
  readonly id: string;
  readonly uploaderUserId: UserId;
  readonly groupId: StudyGroupId;
  readonly context: UploadContext;
  readonly storageKey: string;
  readonly declaredSizeBytes: number;
  readonly declaredMimeType: string;
  /**
   * Optional client-supplied filename, persisted verbatim so finalize
   * can copy it onto the materialized revision row. Null when the
   * uploader didn't pick from the file dialog.
   */
  readonly originalFilename: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
};

export type CreatePendingUploadInput = {
  readonly id: string;
  readonly uploaderUserId: UserId;
  readonly groupId: StudyGroupId;
  readonly context: UploadContext;
  /**
   * The full R2 key the upload is bound to. Stored verbatim so finalize
   * flows look it up by id and the cron sweep deletes the orphan key
   * directly.
   */
  readonly storageKey: string;
  readonly declaredSizeBytes: number;
  readonly declaredMimeType: string;
  readonly originalFilename: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
};

/**
 * Coordination row for the multi-step direct-to-R2 upload flow:
 *   1. `createPending` — client requested a presigned URL.
 *   2. `getPending`    — finalize call resolves the pending row.
 *   3. `deletePending` — finalize success drops the row inside the
 *                        same D1 batch as the downstream write.
 *
 * The hourly cron sweeps `expiresAt < now` rows (the R2 object is
 * deleted best-effort, then the row is dropped). Owning this surface as
 * its own port keeps `core` from reaching into `@hearth/db` directly,
 * which the architecture rules forbid.
 */
export interface UploadCoordinationRepository {
  createPending(input: CreatePendingUploadInput): Promise<void>;
  getPending(id: string): Promise<PendingUpload | null>;
  deletePending(id: string): Promise<void>;
}
