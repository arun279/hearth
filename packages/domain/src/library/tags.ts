/**
 * Tag normalization. Stewards type tags freely; the server stores them
 * lowercase, trimmed, deduped, and capped. Pure so the SPA can preview
 * the normalized value before submit (Nielsen #1 — visibility of system
 * state).
 *
 * Bounds picked to keep the JSON payload small and the FTS5 index
 * predictable: 16 tags × 32 chars × ~5 bytes UTF-8 ≈ 2.5 KB worst case
 * per item.
 */
export const MAX_TAGS = 16;
export const MAX_TAG_CHARS = 32;

export function normalizeTags(input: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const tag = raw.trim().toLowerCase();
    if (tag.length === 0 || tag.length > MAX_TAG_CHARS) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
