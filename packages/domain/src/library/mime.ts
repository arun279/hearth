/**
 * Single source of truth for the Library MIME allowlist. Used by:
 *  - the upload-request use case (server-side enforcement),
 *  - `<UploadDialog>` in the SPA (client-side pre-check before the
 *    presigned PUT, so users see "this file isn't allowed" without
 *    burning a round-trip),
 *  - `displayKindFor()` (every kind here renders to a real
 *    LibraryDisplayKind).
 *
 * Adding a MIME here is the only allowlist change required — the schema
 * stores `mime_type` as free text, and policy doesn't pattern-match.
 */
export const ALLOWED_LIBRARY_MIME_TYPES = [
  "application/pdf",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "video/mp4",
  "video/webm",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/markdown",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type AllowedLibraryMime = (typeof ALLOWED_LIBRARY_MIME_TYPES)[number];

const ALLOWED_SET: ReadonlySet<string> = new Set(ALLOWED_LIBRARY_MIME_TYPES);

export function isAllowedLibraryMime(mimeType: string): boolean {
  return ALLOWED_SET.has(mimeType.toLowerCase());
}

/**
 * Hard size cap for a single Library Revision. R2's single-PUT ceiling is
 * 5 GB; we limit by free-tier bandwidth ergonomics — large files chew up
 * the egress budget on every download. Operators can raise this in
 * `apps/worker` if their cohort needs higher.
 */
export const MAX_LIBRARY_ITEM_BYTES = 95 * 1024 * 1024;

/**
 * Per-instance R2 byte ceiling. The free tier gives 10 GB; we trip the
 * killswitch's `byte_quota_exceeded` denial at 80% to leave headroom for
 * concurrent uploads finishing PUT after request-time. The number is
 * conservative on purpose — once we hit 80%, the operator should retire
 * old items or upgrade the bucket plan rather than barrel into a hard
 * 100% wall mid-upload.
 */
export const INSTANCE_R2_BYTE_BUDGET = 10 * 1024 * 1024 * 1024;
export const INSTANCE_R2_BUDGET_TRIP_RATIO = 0.8;
