import { MAX_SHORT_ANSWER_TEXT_LENGTH } from "../activity/_limits.ts";
import type { QuizQuestion } from "./quiz.ts";
import type { QuizAnswerResponseInput, QuizAnswerResult } from "./quiz-answer.ts";
import { isAnswerKeyRegexSafe } from "./quiz-regex-safety.ts";

/**
 * Grade one quiz answer on the honor system. Runs server-side — the answer
 * key never ships to participants. Grading is fail-soft: any condition that
 * prevents a confident grade (no key authored, key unparseable, key rejected
 * by the safety screen, response shape mismatched) resolves to `no_key`,
 * which is surfaced as "submitted, ungraded" and never blocks completion.
 *
 * Short-answer keys are matched case-insensitively against the trimmed
 * answer — honor-system short answers should accept "Paris" for "paris" —
 * and the candidate is length-capped before matching as the ReDoS backstop
 * behind the compose-time safety screen.
 */
export function evaluateQuizAnswer(
  question: QuizQuestion,
  response: QuizAnswerResponseInput,
): QuizAnswerResult {
  const shape = question.shape;

  if (shape.kind === "multiple_choice") {
    if (response.kind !== "multiple_choice" || shape.answerKeyIndex === undefined) return "no_key";
    return response.selectedIndex === shape.answerKeyIndex ? "correct" : "incorrect";
  }

  if (response.kind !== "short_answer" || shape.answerKeyRegex === undefined) return "no_key";
  if (!isAnswerKeyRegexSafe(shape.answerKeyRegex)) return "no_key";

  let matcher: RegExp;
  try {
    matcher = new RegExp(shape.answerKeyRegex, "i");
  } catch {
    return "no_key";
  }

  const candidate = response.text.trim().slice(0, MAX_SHORT_ANSWER_TEXT_LENGTH);
  return matcher.test(candidate) ? "correct" : "incorrect";
}
