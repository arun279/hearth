import { describe, expect, it } from "vitest";
import { createRegexMatcher } from "../src/regex-matcher.ts";

const matcher = createRegexMatcher();

describe("createRegexMatcher (re2js)", () => {
  it("matches with search (partial) semantics like RegExp.test", () => {
    expect(matcher.matches("^yes$", "yes")).toBe(true);
    expect(matcher.matches("yes", "oh yes indeed")).toBe(true);
    expect(matcher.matches("^yes$", "no")).toBe(false);
  });

  it("compiles RE2 inline flags that native RegExp rejects", () => {
    // `new RegExp("(?i)como estas")` throws in JS; facilitators author
    // RE2/PCRE-style keys, so the engine must accept them.
    expect(matcher.matches("(?i)como estas", "COMO ESTAS")).toBe(true);
  });

  it("isValid accepts compilable patterns and rejects uncompilable ones", () => {
    expect(matcher.isValid("^[a-z]+$")).toBe(true);
    expect(matcher.isValid("(?i)hola")).toBe(true);
    expect(matcher.isValid("(")).toBe(false);
  });

  it("resolves catastrophic-backtracking patterns in linear time", { timeout: 1000 }, () => {
    // Native RegExp pins the thread for minutes on these; a linear-time
    // engine returns at once. The tight timeout is the gate — a regression
    // to a backtracking engine fails here instead of pinning CI.
    // Both are classic catastrophic-backtracking shapes; the trailing "!"
    // means neither can match (the `+` requires an `a` immediately before
    // `$`), which is exactly the case native RegExp explores exponentially.
    const adversarial = `${"a".repeat(50)}!`;
    expect(matcher.matches("(a+)+$", adversarial)).toBe(false);
    expect(matcher.matches("(a|aa)+$", adversarial)).toBe(false);
  });
});
