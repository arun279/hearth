/**
 * Count words in free text for the reflection word-count meter and the
 * advisory `minWords` nudge. Splits on Unicode whitespace and ignores
 * empty runs so leading/trailing/runs-of spaces don't inflate the count.
 * Pure and SPA-importable — the same count drives the live meter in the
 * editor and any server-side advisory check, with no drift.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/u).length;
}
