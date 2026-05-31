/**
 * A regex engine behind a port, so the pure domain (quiz grading) and the
 * use-case layer carry no third-party regex dependency — the same shape as
 * `cuid2` sitting behind `IdGenerator`. The production adapter MUST use a
 * linear-time engine (RE2 semantics): answer-key regexes are authored by
 * facilitators, so a backtracking engine would open a ReDoS /
 * denial-of-wallet vector on a free-tier instance.
 */
export interface RegexMatcher {
  /**
   * True iff `input` contains a match for `pattern` (search, not full
   * match — mirrors `RegExp.prototype.test`). Throws if `pattern` does not
   * compile under the engine; grading callers catch that and fail soft to
   * "ungraded."
   */
  matches(pattern: string, input: string): boolean;
  /**
   * True iff `pattern` compiles under the engine. Used at compose time to
   * reject an answer key that could never grade, before it is stored.
   */
  isValid(pattern: string): boolean;
}
