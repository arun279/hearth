/**
 * Canonical Activity Part kind strings. Activity definitions and their
 * stored JSON envelopes use these as discriminator values — never rename
 * or remove one without a migration strategy for existing rows.
 */
export type ActivityPartKind =
  | "read_library_item"
  | "listen_audio"
  | "watch_video"
  | "write_reflection"
  | "quiz"
  | "attend_session"
  | "embed";

export const ACTIVITY_PART_KINDS = [
  "read_library_item",
  "listen_audio",
  "watch_video",
  "write_reflection",
  "quiz",
  "attend_session",
  "embed",
] as const satisfies readonly ActivityPartKind[];
