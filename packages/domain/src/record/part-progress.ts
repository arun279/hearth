import { z } from "zod";
import { MAX_QUIZ_QUESTIONS, MAX_REFLECTION_LENGTH } from "../activity/_limits.ts";
import { type ActivityPart, quizAnswerSchema } from "../parts/index.ts";

/**
 * Per-Part participant state, discriminated by the Part `kind` it belongs
 * to. `completed` is the honor-system "I finished this Part" flag (toggled
 * by a later milestone's Mark-Complete action); the remaining fields carry
 * the Part's working value: reflection prose, quiz answers, or a resume
 * cursor for passive Parts. Stored inside the versioned envelope on
 * `part_progress.stateJson`.
 */
export const partProgressStateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("read_library_item"),
    completed: z.boolean(),
    scrollPosition: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("listen_audio"),
    completed: z.boolean(),
    playbackPosition: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("watch_video"),
    completed: z.boolean(),
    playbackPosition: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("write_reflection"),
    completed: z.boolean(),
    text: z.string().max(MAX_REFLECTION_LENGTH),
  }),
  z.object({
    kind: z.literal("quiz"),
    completed: z.boolean(),
    answers: z.array(quizAnswerSchema).max(MAX_QUIZ_QUESTIONS),
  }),
  z.object({ kind: z.literal("attend_session"), completed: z.boolean() }),
  z.object({
    kind: z.literal("embed"),
    completed: z.boolean(),
    viewedAt: z.number().int().optional(),
  }),
]);

export type PartProgressState = z.infer<typeof partProgressStateSchema>;

/**
 * Versioned envelope persisted in `part_progress.stateJson`. The adapter
 * parses through this on read so a malformed or future-version row surfaces
 * as a validation failure rather than silently rendering a malformed value.
 */
export const partProgressEnvelopeSchema = z.object({
  v: z.literal(1),
  data: partProgressStateSchema,
});

export type PartProgressEnvelope = z.infer<typeof partProgressEnvelopeSchema>;

/**
 * The empty starting state for a freshly-touched Part, keyed off its kind.
 * Single source of truth for the first-time create path (and, in a later
 * milestone, the revision-restart reset step). Reflection starts with empty
 * text; quiz with no answers; every kind starts `completed: false`.
 */
export function initialPartProgressState(part: ActivityPart): PartProgressState {
  switch (part.kind) {
    case "read_library_item":
      return { kind: "read_library_item", completed: false };
    case "listen_audio":
      return { kind: "listen_audio", completed: false };
    case "watch_video":
      return { kind: "watch_video", completed: false };
    case "write_reflection":
      return { kind: "write_reflection", completed: false, text: "" };
    case "quiz":
      return { kind: "quiz", completed: false, answers: [] };
    case "attend_session":
      return { kind: "attend_session", completed: false };
    case "embed":
      return { kind: "embed", completed: false };
    default:
      part satisfies never;
      throw new Error(`Unknown part kind: ${(part as { kind: string }).kind}`);
  }
}
