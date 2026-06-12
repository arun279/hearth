import { z } from "zod";
import { attendSessionPartSchema } from "./attend-session.ts";
import { embedPartSchema } from "./embed.ts";
import { listenAudioPartSchema } from "./listen-audio.ts";
import { quizPartSchema } from "./quiz.ts";
import { readLibraryItemPartSchema } from "./read-library-item.ts";
import { watchVideoPartSchema } from "./watch-video.ts";
import { writeReflectionPartSchema } from "./write-reflection.ts";

/**
 * Canonical Activity Part kind strings. Activity definitions and their
 * stored JSON envelopes use these as discriminator values — never rename
 * or remove one without a migration strategy for existing rows. Short
 * display labels ("read", "listen", …) live only in `packages/ui` as a
 * presentation-layer mapping; never leak short names into the wire format
 * or stored JSON.
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

/**
 * Discriminated-union schema over every v1 Part kind. The discriminator is
 * `kind`; each variant's own schema in `parts/*` enforces variant-specific
 * fields. Together with `partsEnvelopeSchema` (in `activity/envelope.ts`)
 * this is the authoritative wire shape for `learning_activities.partsJson`.
 */
export const activityPartSchema = z.discriminatedUnion("kind", [
  readLibraryItemPartSchema,
  listenAudioPartSchema,
  watchVideoPartSchema,
  writeReflectionPartSchema,
  quizPartSchema,
  attendSessionPartSchema,
  embedPartSchema,
]);

export type ActivityPart = z.infer<typeof activityPartSchema>;

export type { AttendSessionPart } from "./attend-session.ts";
export type { EmbedPart } from "./embed.ts";
export type { ListenAudioPart } from "./listen-audio.ts";
export type { QuizAnswer, QuizPart, QuizQuestion } from "./quiz.ts";
export { quizAnswerSchema, redactQuizAnswerKeys } from "./quiz.ts";
export { evaluateQuizAnswer, type QuizVerdict } from "./quiz-evaluate.ts";
export type { ReadLibraryItemPart } from "./read-library-item.ts";
export type { WatchVideoPart } from "./watch-video.ts";
export { countWords } from "./word-count.ts";
export type { WriteReflectionPart } from "./write-reflection.ts";
export {
  attendSessionPartSchema,
  embedPartSchema,
  listenAudioPartSchema,
  quizPartSchema,
  readLibraryItemPartSchema,
  watchVideoPartSchema,
  writeReflectionPartSchema,
};
