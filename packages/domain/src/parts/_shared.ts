import { z } from "zod";
import { MAX_ID_LENGTH, MAX_MEDIA_OFFSET_SECONDS, MAX_TITLE_LENGTH } from "../activity/_limits.ts";

const partIdField = z.string().min(1).max(MAX_ID_LENGTH);
const libraryItemIdField = z.string().min(1).max(MAX_ID_LENGTH);
const pinnedRevisionField = z.string().min(1).max(MAX_ID_LENGTH).optional();
const titleField = z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional();
const secondsField = z.number().nonnegative().max(MAX_MEDIA_OFFSET_SECONDS).optional();

/**
 * Two of the seven Part kinds — `listen_audio` and `watch_video` —
 * share an identical wire shape (library ref + optional time-window
 * + optional title). The factory below eliminates the structural
 * duplication while preserving each kind's distinct discriminator
 * literal so the union still narrows correctly. New media kinds (e.g.
 * `interactive_simulation`) join here without forking another file.
 */
export function mediaTimeBoundedPartSchema<K extends "listen_audio" | "watch_video">(kind: K) {
  return z
    .object({
      kind: z.literal(kind),
      id: partIdField,
      libraryItemId: libraryItemIdField,
      pinnedRevisionId: pinnedRevisionField,
      startSeconds: secondsField,
      endSeconds: secondsField,
      title: titleField,
    })
    .refine(
      (p) =>
        p.startSeconds === undefined ||
        p.endSeconds === undefined ||
        p.endSeconds >= p.startSeconds,
      { message: "endSeconds must be ≥ startSeconds.", path: ["endSeconds"] },
    );
}
