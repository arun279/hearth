import type { LibraryDisplayKind } from "./types.ts";

/**
 * Project a MIME type onto the SPA's display-kind enum. Pure: the same
 * function runs in the SPA bundle (for upload-time previews) and on the
 * server (for the byGroup payload). Adding a new MIME means adding a row
 * here and to `isAllowedLibraryMime` — there is no schema or migration.
 *
 * Unknown MIMEs map to `"other"` so the SPA still renders something
 * sensible even if a steward uploaded an exotic type before policy
 * tightened.
 */
export function displayKindFor(mimeType: string): LibraryDisplayKind {
  const m = mimeType.toLowerCase();
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("image/")) return "image";
  if (
    m === "text/markdown" ||
    m === "text/plain" ||
    m === "application/msword" ||
    m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "doc";
  }
  return "other";
}
