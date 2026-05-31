import type { QuizAnswer, QuizQuestion } from "./quiz.ts";

/**
 * Honor-system grading verdict for one quiz question.
 *
 *   - `correct` / `incorrect`: an answer key exists and the answer was
 *     compared against it.
 *   - `no_key`: the author left this question ungraded (no `answerKeyIndex`
 *     / no `correctAnswer`). Ungraded questions are excluded from the
 *     score denominator and never block the learner.
 */
export type QuizVerdict = "correct" | "incorrect" | "no_key";

/**
 * Normalize a short-answer string for comparison. The whitespace collapse
 * + NFC canonicalization always apply; case-folding and diacritic-stripping
 * apply only in forgiving mode (`exactMatch === false`).
 *
 * `toLowerCase` (not `toLocaleLowerCase`): the domain layer stays
 * locale-deterministic, so Turkish dotless-i and German ß are known limits
 * — facilitators route those through `alsoAccept` or `exactMatch`. The
 * `\s+` and `\p{Diacritic}` patterns are compile-time constants, never
 * author input, so there is no backtracking surface.
 */
function normalize(value: string, exactMatch: boolean): string {
  const collapsed = value.trim().replace(/\s+/gu, " ");
  if (exactMatch) return collapsed.normalize("NFC");
  return collapsed
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .normalize("NFC");
}

/**
 * Grade one quiz answer against its question. Pure and synchronous, with no
 * third-party dependency, so it stays SPA-importable.
 *
 * Multiple-choice compares the selected index to the key. Short-answer
 * normalizes the typed answer and tests it for membership in the normalized
 * accept-set (`correctAnswer` plus `alsoAccept`) — plain equality, no
 * pattern engine, ReDoS-safe by construction. An empty answer to a keyed
 * question is `incorrect` (gradeable, not attempted) rather than `no_key`,
 * so it counts against the score the same way a wrong answer does.
 */
export function evaluateQuizAnswer(
  question: QuizQuestion,
  answer: QuizAnswer | undefined,
): QuizVerdict {
  const shape = question.shape;

  if (shape.kind === "multiple_choice") {
    if (shape.answerKeyIndex === undefined) return "no_key";
    if (answer?.kind !== "multiple_choice" || answer.selectedIndex === null) return "incorrect";
    return answer.selectedIndex === shape.answerKeyIndex ? "correct" : "incorrect";
  }

  if (shape.correctAnswer === undefined) return "no_key";
  if (answer?.kind !== "short_answer") return "incorrect";
  const learner = normalize(answer.text, shape.exactMatch);
  if (learner === "") return "incorrect";
  const accept = new Set(
    [shape.correctAnswer, ...shape.alsoAccept].map((a) => normalize(a, shape.exactMatch)),
  );
  return accept.has(learner) ? "correct" : "incorrect";
}
