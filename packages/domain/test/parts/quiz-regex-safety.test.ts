import { describe, expect, it } from "vitest";
import { isAnswerKeyRegexSafe } from "../../src/parts/quiz-regex-safety.ts";

/**
 * The authoritative accept/reject table for the ReDoS screen. Add a new
 * evil shape to `UNSAFE` the moment one is found — this table is the
 * contract the screen must satisfy, and the screen is the primary
 * compose-time defense against a catastrophic-backtracking answer key.
 */
const UNSAFE = [
  "(a+)+$",
  "(a*)*$",
  "(a|aa)+$",
  "(a|a?)+$",
  "([a-zA-Z]+)*$",
  "(x+x+)+y",
  "(.*)+",
  "(\\d|\\d\\d)+",
  "((ab)+)+",
];

const SAFE = [
  "^yes$",
  "^[A-Za-z]+$",
  "\\b(quiz|test)\\b",
  "^[a-z]{1,50}$",
  "colou?r",
  "(cat|dog)",
  "^a+$",
  "[A-Z]+\\d*",
  "",
  "paris",
];

describe("isAnswerKeyRegexSafe", () => {
  for (const source of UNSAFE) {
    it(`rejects ${JSON.stringify(source)}`, () => {
      expect(isAnswerKeyRegexSafe(source)).toBe(false);
    });
  }

  for (const source of SAFE) {
    it(`accepts ${JSON.stringify(source)}`, () => {
      expect(isAnswerKeyRegexSafe(source)).toBe(true);
    });
  }

  it("ignores quantifiers and alternation inside character classes", () => {
    expect(isAnswerKeyRegexSafe("[a+b|c]+")).toBe(true);
    expect(isAnswerKeyRegexSafe("[(]+")).toBe(true);
  });

  it("treats escaped metacharacters as literals", () => {
    expect(isAnswerKeyRegexSafe("\\(a\\|b\\)")).toBe(true);
  });

  it("does not flag a non-quantified alternation group", () => {
    expect(isAnswerKeyRegexSafe("(red|green|blue)")).toBe(true);
  });
});
