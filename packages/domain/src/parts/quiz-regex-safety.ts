/**
 * Static ReDoS screen for a facilitator-authored short-answer answer-key
 * regex. A user-supplied pattern matched at grading time is a
 * catastrophic-backtracking (ReDoS) vector; this rejects the dangerous
 * shapes at compose time so they never reach the grader.
 *
 * This is the PRIMARY compose-time defense. It pairs with an input-length
 * cap at evaluate time (`MAX_SHORT_ANSWER_TEXT_LENGTH`) — note that an
 * in-process timeout (`Promise.race` against a timer) does NOT bound a
 * synchronous regex on a single-threaded JS runtime: the match monopolizes
 * the isolate and the timer can't fire until it already finished. The
 * residual (a heuristic-evading pathological pattern) is bounded by the
 * input cap and tracked for a non-backtracking-engine follow-up.
 *
 * The screen over-approximates: it rejects the two structural shapes that
 * produce exponential backtracking — an outer-quantified group whose body
 * holds either (1) a nested quantifier or (2) top-level alternation — after
 * neutralizing escapes and character classes. A false positive costs the
 * author one rewrite; a false negative costs CPU, so the bias is to reject.
 * Pure and SPA-importable so the composer screens client-side with the same
 * logic the server enforces.
 */

/**
 * Collapse escapes (`\x`) and character classes (`[...]`) to a single
 * placeholder atom so the structural scan sees only real grouping,
 * quantifier, and alternation metacharacters — a `+` inside `[a+b]` or an
 * escaped `\(` must never read as structure.
 */
function neutralize(source: string): string {
  let out = "";
  for (let i = 0; i < source.length; ) {
    const c = source[i];
    if (c === "\\") {
      out += "_";
      i += 2;
      continue;
    }
    if (c === "[") {
      i += 1;
      while (i < source.length && source[i] !== "]") {
        i += source[i] === "\\" ? 2 : 1;
      }
      if (i < source.length) i += 1;
      out += "_";
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** A quantifier metacharacter (`*`, `+`, or a `{...}` repeat) anywhere in the body. */
function bodyHasNestedQuantifier(body: string): boolean {
  return /[*+{]/.test(body);
}

/** An alternation `|` at the body's own nesting level (not inside a nested group). */
function bodyHasTopLevelAlternation(body: string): boolean {
  let depth = 0;
  for (const c of body) {
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (c === "|" && depth === 0) return true;
  }
  return false;
}

export function isAnswerKeyRegexSafe(source: string): boolean {
  const s = neutralize(source);
  const groupStarts: number[] = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === "(") {
      groupStarts.push(i);
      continue;
    }
    if (c !== ")") continue;
    const start = groupStarts.pop();
    if (start === undefined) continue;

    const outer = s[i + 1] ?? "";
    const repeated = outer === "*" || outer === "+";
    const quantified = repeated || outer === "?" || outer === "{";
    if (!quantified) continue;

    const body = s.slice(start + 1, i);
    if (bodyHasNestedQuantifier(body)) return false;
    if (repeated && bodyHasTopLevelAlternation(body)) return false;
  }
  return true;
}
