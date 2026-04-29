/**
 * The minimum trimmed length a search query must reach before the use
 * case round-trips to D1. One- and two-character queries explode the
 * FTS5 result set on a small library and produce noise the user would
 * just type past anyway; the SPA's debounce + this floor mean a typing
 * burst lands one query per phrase, not one per keystroke.
 */
export const MIN_SEARCH_QUERY_LENGTH = 2;

/**
 * FTS5 reserves these characters for query syntax (column filters,
 * prefix wildcards, phrase quoting, parentheses, NEAR operator). User
 * input arrives raw, so a stray `:` in `C++:` would parse as a column
 * filter and either error or silently match nothing. Wrapping each
 * normalized token in double quotes turns it into a verbatim phrase
 * search, which sidesteps every metacharacter at once — but the quotes
 * themselves can't appear inside the phrase, so we strip them first.
 *
 * `*` doubles as the prefix-search operator. We strip it instead of
 * preserving it as a feature: prefix wildcards on a small index expand
 * to most of the corpus and the SPA does its own narrowing as the user
 * keeps typing.
 */
const FTS5_QUERY_METACHARS = /["*:()]/g;

/**
 * Normalize a raw query for the FTS5 `MATCH` clause.
 *
 * Returns `null` when the user has not yet typed enough to commit to a
 * round-trip — the API treats this as a 200 + empty-items response, not
 * an error, so the SPA can debounce typing without flashing error UI.
 *
 * The output is a space-joined sequence of double-quoted phrase tokens
 * (`"foo" "bar"`) with FTS5 metacharacters stripped from each token's
 * interior. FTS5 treats this as an implicit AND across the tokens —
 * matching the user expectation that "spanish handout" finds items
 * mentioning both words, not either.
 */
export function normalizeSearchQuery(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < MIN_SEARCH_QUERY_LENGTH) return null;

  const tokens = trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(FTS5_QUERY_METACHARS, ""))
    .filter((token) => token.length > 0);

  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"`).join(" ");
}
