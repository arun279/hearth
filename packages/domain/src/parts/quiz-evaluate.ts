import type { QuizAnswer, QuizQuestion } from "./quiz.ts";

/**
 * Honor-system grading verdict for one quiz question.
 *
 *   - `correct` / `incorrect`: an answer key exists and the answer was
 *     compared against it.
 *   - `no_key`: the author left this question ungraded (no `answerKeyIndex`
 *     / no `answerKeyRegex`), OR a short-answer key could not be matched
 *     safely (see `matches`). Ungraded questions are excluded from the
 *     score denominator and never block the learner.
 */
export type QuizVerdict = "correct" | "incorrect" | "no_key";

/**
 * Grade one quiz answer against its question. Pure and synchronous — the
 * regex engine is injected as `matches` so this module carries no
 * third-party dependency and stays SPA-importable. The injected matcher
 * is expected to use a linear-time engine (so short-answer grading cannot
 * be turned into a CPU-pinning attack by a hostile answer key) and may
 * throw on an uncompilable pattern; that throw is caught here and
 * resolved to `no_key` — fail-soft, never a wrong grade, never a block.
 *
 * Multiple-choice compares the selected index to the key. Short-answer
 * tests the trimmed answer against the key regex. An empty answer to a
 * keyed question is `incorrect` (gradeable, not attempted) rather than
 * `no_key`, so it counts against the score the same way a wrong answer
 * does.
 */
export function evaluateQuizAnswer(
  question: QuizQuestion,
  answer: QuizAnswer | undefined,
  matches: (pattern: string, input: string) => boolean,
): QuizVerdict {
  const shape = question.shape;

  if (shape.kind === "multiple_choice") {
    if (shape.answerKeyIndex === undefined) return "no_key";
    if (answer?.kind !== "multiple_choice" || answer.selectedIndex === null) return "incorrect";
    return answer.selectedIndex === shape.answerKeyIndex ? "correct" : "incorrect";
  }

  if (shape.answerKeyRegex === undefined) return "no_key";
  if (answer?.kind !== "short_answer") return "incorrect";
  const trimmed = answer.text.trim();
  if (trimmed === "") return "incorrect";
  try {
    return matches(shape.answerKeyRegex, trimmed) ? "correct" : "incorrect";
  } catch {
    return "no_key";
  }
}
