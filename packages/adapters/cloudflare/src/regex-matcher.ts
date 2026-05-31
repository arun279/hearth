import type { RegexMatcher } from "@hearth/ports";
import { RE2JS } from "re2js";

/**
 * `RegexMatcher` backed by re2js — a pure-JS port of Google's RE2. RE2
 * matches in time linear in the input length with no backtracking, so a
 * pathological answer key such as `(a+)+$` cannot be weaponised into a
 * CPU-pinning request. `find()` is a partial-match search (mirrors
 * `RegExp.prototype.test`); `compile` throws on invalid or unsupported
 * patterns, which callers translate into "ungraded" at grade time or a
 * validation error at compose time.
 */
export function createRegexMatcher(): RegexMatcher {
  return {
    matches(pattern, input) {
      return RE2JS.compile(pattern).matcher(input).find();
    },
    isValid(pattern) {
      try {
        RE2JS.compile(pattern);
        return true;
      } catch {
        return false;
      }
    },
  };
}
