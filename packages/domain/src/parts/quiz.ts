import { z } from "zod";
import {
  MAX_ID_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_QUIZ_OPTION_TEXT,
  MAX_QUIZ_OPTIONS_PER_QUESTION,
  MAX_QUIZ_QUESTIONS,
} from "../activity/_limits.ts";

const partIdField = z.string().min(1).max(MAX_ID_LENGTH);
const questionIdField = z.string().min(1).max(MAX_ID_LENGTH);

const multipleChoiceShape = z.object({
  kind: z.literal("multiple_choice"),
  options: z
    .array(z.string().trim().min(1).max(MAX_QUIZ_OPTION_TEXT))
    .min(2)
    .max(MAX_QUIZ_OPTIONS_PER_QUESTION),
  answerKeyIndex: z.number().int().nonnegative().optional(),
});

const acceptedAnswer = z.string().trim().min(1).max(MAX_QUIZ_OPTION_TEXT);

const shortAnswerShape = z.object({
  kind: z.literal("short_answer"),
  /** Absent => ungraded (fail-soft, mirrors `answerKeyIndex === undefined`). */
  correctAnswer: acceptedAnswer.optional(),
  /** Additional literal spellings that also grade correct (e.g. accent or
   * case variants the normalizer doesn't already fold). */
  alsoAccept: z.array(acceptedAnswer).max(MAX_QUIZ_OPTIONS_PER_QUESTION).default([]),
  /** When true, grading is case- + accent-sensitive (still trims +
   * collapses whitespace + canonicalizes encoding). Default forgiving. */
  exactMatch: z.boolean().default(false),
});

export const quizQuestionSchema = z
  .object({
    id: questionIdField,
    prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
    shape: z.discriminatedUnion("kind", [multipleChoiceShape, shortAnswerShape]),
    explainAfterAnswer: z.string().trim().max(MAX_PROMPT_LENGTH).optional(),
  })
  .refine(
    (q) =>
      q.shape.kind !== "multiple_choice" ||
      q.shape.answerKeyIndex === undefined ||
      q.shape.answerKeyIndex < q.shape.options.length,
    { message: "answerKeyIndex must point at a real option.", path: ["shape", "answerKeyIndex"] },
  )
  .refine(
    (q) =>
      q.shape.kind !== "short_answer" ||
      q.shape.correctAnswer !== undefined ||
      q.shape.alsoAccept.length === 0,
    {
      message: "Add a correct answer, or clear the accepted list to leave this question ungraded.",
      path: ["shape", "alsoAccept"],
    },
  );

export type QuizQuestion = z.infer<typeof quizQuestionSchema>;

export const quizPartSchema = z.object({
  kind: z.literal("quiz"),
  id: partIdField,
  questions: z.array(quizQuestionSchema).min(1).max(MAX_QUIZ_QUESTIONS),
});

export type QuizPart = z.infer<typeof quizPartSchema>;

/**
 * A participant's answer to one quiz question, discriminated by the same
 * `kind` as the question's `shape`. `selectedIndex: null` and an empty
 * `text` both mean "not answered." Answers are validated against the
 * activity's authored questions in the submit use case (every `questionId`
 * must exist, kinds must line up); this schema only fixes the wire shape.
 */
export const quizAnswerSchema = z.discriminatedUnion("kind", [
  z.object({
    questionId: questionIdField,
    kind: z.literal("multiple_choice"),
    selectedIndex: z.number().int().nonnegative().max(MAX_QUIZ_OPTIONS_PER_QUESTION).nullable(),
  }),
  z.object({
    questionId: questionIdField,
    kind: z.literal("short_answer"),
    text: z.string().max(MAX_QUIZ_OPTION_TEXT),
  }),
]);

export type QuizAnswer = z.infer<typeof quizAnswerSchema>;

/**
 * Strip the grading keys (`answerKeyIndex` for multiple-choice;
 * `correctAnswer` / `alsoAccept` / `exactMatch` for short-answer) from a
 * quiz Part before it crosses the wire to a learner. The Activity Player needs
 * the prompts + options + post-answer explanations to render, but never the
 * keys — those stay server-side so the auto-score can't be read off the
 * network tab. Grading happens in the use case (which reads the unredacted
 * `partsJson`); the correct choice is revealed per-question only in the
 * submit response, after the learner has answered.
 */
export function redactQuizAnswerKeys(part: QuizPart): QuizPart {
  return {
    ...part,
    questions: part.questions.map((q) => ({
      ...q,
      shape:
        q.shape.kind === "multiple_choice"
          ? { kind: "multiple_choice", options: q.shape.options }
          : // `correctAnswer` (the secret) and the `alsoAccept` contents are
            // dropped; the empty defaults keep the shape schema-valid without
            // revealing the key.
            { kind: "short_answer", alsoAccept: [], exactMatch: false },
    })),
  };
}
