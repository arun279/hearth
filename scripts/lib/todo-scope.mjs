/**
 * TODO-scope matchers + classifier, shared by `scripts/check-conventions.mjs`
 * and unit-tested in `todo-scope.test.mjs`.
 *
 * Project rule: every committed `TODO(` must name a single owning milestone
 * (`TODO(m11)`, `TODO(m10.5)`). A non-milestone scope, a milestone range, or a
 * bare `TODO` is debt that looks tracked but has no home — re-scope it to the
 * milestone that owns the work, or do the work now and delete the marker.
 */

/** A `TODO(` scoped to a single milestone: `m` + digits + optional `.digits` (m10.5). */
const VALID_MILESTONE_TODO = /TODO\(m\d+(?:\.\d+)?\)/;

/** Any TODO marker: parenthesised `TODO(` or a standalone `TODO` word. */
const ANY_TODO = /TODO(?:\(|\b)/;

/**
 * @param {string} line
 * @returns {"none" | "valid" | "unscoped"}
 */
export function classifyTodo(line) {
  if (!ANY_TODO.test(line)) return "none";
  if (VALID_MILESTONE_TODO.test(line)) return "valid";
  return "unscoped";
}

/**
 * Parse a milestone token (`m10`, `m10.5`) to its numeric value, or null for a
 * non-milestone token. Fractional milestones (M10.5) compare as 10.5 — never
 * truncated to 10, which would make a `TODO(m10.5)` read as the shipped M10.
 *
 * @param {string} token
 * @returns {number | null}
 */
export function parseMilestone(token) {
  const m = /^m(\d+(?:\.\d+)?)$/.exec(token);
  return m ? Number(m[1]) : null;
}
