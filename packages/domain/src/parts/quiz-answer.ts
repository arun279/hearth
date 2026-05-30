import { z } from "zod";
import {
  MAX_QUIZ_OPTIONS_PER_QUESTION,
  MAX_SHORT_ANSWER_TEXT_LENGTH,
} from "../activity/_limits.ts";

/**
 * A participant's raw response to one quiz question, before grading.
 * `selectedIndex` is bounded by the per-question option cap; the grader
 * cross-checks it against the actual option count. Short-answer text is
 * capped (see `MAX_SHORT_ANSWER_TEXT_LENGTH`) — that bound is also the
 * ReDoS input-length backstop for answer-key matching.
 */
export const quizAnswerResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("multiple_choice"),
    selectedIndex: z.number().int().nonnegative().lt(MAX_QUIZ_OPTIONS_PER_QUESTION),
  }),
  z.object({
    kind: z.literal("short_answer"),
    text: z.string().max(MAX_SHORT_ANSWER_TEXT_LENGTH),
  }),
]);
export type QuizAnswerResponseInput = z.infer<typeof quizAnswerResponseSchema>;

/**
 * The honor-system grade for one answer. `no_key` means the question had
 * no usable answer key (none authored, or a key that failed the safety
 * screen) — ungraded, never blocking.
 */
export const QUIZ_ANSWER_RESULTS = ["correct", "incorrect", "no_key"] as const;
export type QuizAnswerResult = (typeof QUIZ_ANSWER_RESULTS)[number];
export const quizAnswerResultSchema = z.enum(QUIZ_ANSWER_RESULTS);
