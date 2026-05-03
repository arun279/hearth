import { z } from "zod";

const partIdField = z.string().min(1).max(64);
const questionIdField = z.string().min(1).max(64);

const multipleChoiceShape = z.object({
  kind: z.literal("multiple_choice"),
  options: z.array(z.string().trim().min(1).max(500)).min(2).max(10),
  answerKeyIndex: z.number().int().nonnegative().optional(),
});

const shortAnswerShape = z.object({
  kind: z.literal("short_answer"),
  answerKeyRegex: z.string().max(500).optional(),
});

export const quizQuestionSchema = z
  .object({
    id: questionIdField,
    prompt: z.string().trim().min(1).max(2_000),
    shape: z.discriminatedUnion("kind", [multipleChoiceShape, shortAnswerShape]),
    explainAfterAnswer: z.string().trim().max(2_000).optional(),
  })
  .refine(
    (q) =>
      q.shape.kind !== "multiple_choice" ||
      q.shape.answerKeyIndex === undefined ||
      q.shape.answerKeyIndex < q.shape.options.length,
    { message: "answerKeyIndex must point at a real option.", path: ["shape", "answerKeyIndex"] },
  );

export type QuizQuestion = z.infer<typeof quizQuestionSchema>;

export const quizPartSchema = z.object({
  kind: z.literal("quiz"),
  id: partIdField,
  questions: z.array(quizQuestionSchema).min(1).max(50),
});

export type QuizPart = z.infer<typeof quizPartSchema>;
