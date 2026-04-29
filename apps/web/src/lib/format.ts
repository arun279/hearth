/**
 * Locale-aware short date — "Apr 25, 2026" in en-US. Used in admin tabs
 * for grant/revoke/added-at timestamps. Matches the prototype's editorial
 * tone: month name spelled out, no time-of-day, no relative phrases.
 */
export function formatShortDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const DAY_MS = 24 * 60 * 60 * 1000;

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/**
 * Coarse relative time for invitation expiry — "in 14 days", "yesterday",
 * "today", "in 3 hours". Falls back to a calendar date when the delta is
 * more than 30 days out so the admin sees an exact value for long
 * windows. The expected callsite is the invitations panel: we want
 * "expires in 4 days" to be the dominant tone, not raw ISO.
 */
export function formatRelative(target: Date | string, now: Date = new Date()): string {
  const date = typeof target === "string" ? new Date(target) : target;
  const deltaMs = date.getTime() - now.getTime();
  const absMs = Math.abs(deltaMs);

  if (absMs < 60 * 1000) return RELATIVE.format(0, "minute");
  if (absMs < 60 * 60 * 1000) {
    return RELATIVE.format(Math.round(deltaMs / (60 * 1000)), "minute");
  }
  if (absMs < DAY_MS) {
    return RELATIVE.format(Math.round(deltaMs / (60 * 60 * 1000)), "hour");
  }
  const days = Math.round(deltaMs / DAY_MS);
  if (Math.abs(days) <= 30) return RELATIVE.format(days, "day");
  return formatShortDate(date);
}

const SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;

/**
 * Compact byte formatter — "4.2 MB", "412 KB". Used by the Library card
 * for revision size. Keeps two significant digits at MB+ and rounds at
 * KB so we never render "4.20 MB" when "4.2 MB" reads better.
 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  let i = 0;
  let v = n;
  while (v >= 1024 && i < SIZE_UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  if (i === 0) return `${Math.round(v)} ${SIZE_UNITS[i]}`;
  if (i === 1) return `${Math.round(v)} ${SIZE_UNITS[i]}`;
  return `${v.toFixed(1)} ${SIZE_UNITS[i]}`;
}
