/**
 * Locale-aware short date — "Apr 25, 2026" in en-US. Used in admin tabs
 * for grant/revoke/added-at timestamps. Matches the prototype's editorial
 * tone: month name spelled out, no time-of-day, no relative phrases.
 */
export function formatShortDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
