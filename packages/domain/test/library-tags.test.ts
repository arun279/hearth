import { describe, expect, it } from "vitest";
import { MAX_TAG_CHARS, MAX_TAGS, normalizeTags } from "../src/library/tags.ts";

describe("normalizeTags", () => {
  it("lowercases, trims, and dedupes", () => {
    expect(normalizeTags(["Spanish", " spanish ", "GRAMMAR", "grammar"])).toEqual([
      "spanish",
      "grammar",
    ]);
  });

  it("drops empty inputs", () => {
    expect(normalizeTags(["", "   ", "ok"])).toEqual(["ok"]);
  });

  it("drops tags exceeding the per-tag char cap", () => {
    const tooLong = "a".repeat(MAX_TAG_CHARS + 1);
    expect(normalizeTags([tooLong, "fine"])).toEqual(["fine"]);
  });

  it("caps the number of tags", () => {
    const many = Array.from({ length: MAX_TAGS + 5 }, (_, i) => `t${i}`);
    expect(normalizeTags(many)).toHaveLength(MAX_TAGS);
  });
});
