/**
 * Count whitespace-delimited words in free text. Shared by the SPA
 * reflection word-count meter and the server-side `minWords` advisory
 * check so both report the same number. `minWords` is a soft nudge, never
 * a hard gate, so an approximate-but-consistent count is the right
 * contract: trimmed, split on any run of Unicode whitespace, empty → 0.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/u).length;
}
