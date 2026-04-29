import { describe, expect, it } from "vitest";
import { MIN_SEARCH_QUERY_LENGTH, normalizeSearchQuery } from "../src/library/search.ts";

describe("normalizeSearchQuery", () => {
  it("returns null for queries below the minimum length", () => {
    expect(normalizeSearchQuery("")).toBeNull();
    expect(normalizeSearchQuery(" ")).toBeNull();
    expect(normalizeSearchQuery("a")).toBeNull();
    expect(normalizeSearchQuery(" a ")).toBeNull();
  });

  it("admits two-character queries (the minimum)", () => {
    expect(normalizeSearchQuery("hi".slice(0, MIN_SEARCH_QUERY_LENGTH))).toBe('"hi"');
  });

  it("trims and lowercases", () => {
    expect(normalizeSearchQuery("  Spanish  ")).toBe('"spanish"');
    expect(normalizeSearchQuery("CAFÉ")).toBe('"café"');
  });

  it("collapses internal whitespace into AND-joined phrases", () => {
    expect(normalizeSearchQuery("spanish   handout")).toBe('"spanish" "handout"');
    expect(normalizeSearchQuery("a b c")).toBe('"a" "b" "c"');
  });

  it("escapes FTS5 metacharacters by stripping them from token interiors", () => {
    expect(normalizeSearchQuery('quote"end')).toBe('"quoteend"');
    expect(normalizeSearchQuery("col:val")).toBe('"colval"');
    expect(normalizeSearchQuery("(group)")).toBe('"group"');
    expect(normalizeSearchQuery("prefix*")).toBe('"prefix"');
  });

  it("leaves non-metacharacter punctuation intact (FTS5's tokenizer drops it at index time)", () => {
    expect(normalizeSearchQuery("c++")).toBe('"c++"');
    expect(normalizeSearchQuery("a+b")).toBe('"a+b"');
  });

  it("returns null when stripping leaves no usable tokens", () => {
    expect(normalizeSearchQuery('""')).toBeNull();
    expect(normalizeSearchQuery("***")).toBeNull();
    expect(normalizeSearchQuery("()")).toBeNull();
  });

  it("preserves diacritics — FTS5's tokenizer normalizes them at index time", () => {
    expect(normalizeSearchQuery("español")).toBe('"español"');
    expect(normalizeSearchQuery("piñata")).toBe('"piñata"');
  });

  it("preserves hyphens and apostrophes inside tokens", () => {
    expect(normalizeSearchQuery("self-study")).toBe('"self-study"');
    expect(normalizeSearchQuery("don't go")).toBe('"don\'t" "go"');
  });
});
