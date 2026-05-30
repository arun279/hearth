import { z } from "zod";
import {
  MAX_ID_LENGTH,
  MAX_QUIZ_QUESTIONS,
  MAX_REFLECTION_TEXT_LENGTH,
} from "../activity/_limits.ts";
import { quizAnswerResponseSchema, quizAnswerResultSchema } from "../parts/quiz-answer.ts";

const questionIdField = z.string().min(1).max(MAX_ID_LENGTH);

/**
 * A graded answer as persisted in part progress. `correctIndex` and
 * `explanation` are server-populated post-answer reveals — present only
 * for an already-graded question, never round-tripped from the client.
 */
export const quizAnswerSchema = z.object({
  questionId: questionIdField,
  response: quizAnswerResponseSchema,
  result: quizAnswerResultSchema,
  correctIndex: z.number().int().nonnegative().optional(),
  explanation: z.string().optional(),
});

/**
 * The authoritative `part_progress.stateJson` payload, discriminated by
 * Part kind. Read and written as a whole. Each variant carries the
 * honor-system `completed` flag plus any durable authored content.
 */
export const partProgressStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("read_library_item"), completed: z.boolean() }),
  z.object({ kind: z.literal("listen_audio"), completed: z.boolean() }),
  z.object({ kind: z.literal("watch_video"), completed: z.boolean() }),
  z.object({
    kind: z.literal("write_reflection"),
    completed: z.boolean(),
    text: z.string().max(MAX_REFLECTION_TEXT_LENGTH),
  }),
  z.object({
    kind: z.literal("quiz"),
    completed: z.boolean(),
    answers: z.array(quizAnswerSchema).max(MAX_QUIZ_QUESTIONS),
  }),
  z.object({ kind: z.literal("attend_session"), completed: z.boolean() }),
  z.object({ kind: z.literal("embed"), completed: z.boolean() }),
]);

/**
 * Versioned envelope stored in `part_progress.stateJson` and
 * `part_history.stateJson`. The `v` discriminator anchors read-time
 * shims; the adapter re-parses through this before persisting, so a
 * malformed or unknown-version row is caught at the boundary.
 */
export const partProgressStateEnvelopeSchema = z.object({
  v: z.literal(1),
  data: partProgressStateSchema,
});
export type PartProgressStateEnvelope = z.infer<typeof partProgressStateEnvelopeSchema>;

/**
 * Request body for a quiz submission: one response per answered question.
 * The server grades each against the (server-only) answer key and persists
 * the graded `QuizAnswer[]`. Questions may be omitted (partial submission);
 * the route maps each `questionId` to a real question and rejects unknowns.
 */
export const quizSubmissionSchema = z.object({
  answers: z
    .array(z.object({ questionId: questionIdField, response: quizAnswerResponseSchema }))
    .max(MAX_QUIZ_QUESTIONS),
});
export type QuizSubmission = z.infer<typeof quizSubmissionSchema>;
