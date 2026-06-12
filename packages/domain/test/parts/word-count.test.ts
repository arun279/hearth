import { describe, expect, it } from "vitest";
import { countWords } from "../../src/parts/word-count.ts";

describe("countWords", () => {
  it("returns 0 for empty or whitespace-only input", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("\n\t  ")).toBe(0);
  });

  it("counts a single word", () => {
    expect(countWords("hello")).toBe(1);
  });

  it("collapses runs of whitespace and trims edges", () => {
    expect(countWords("hello world")).toBe(2);
    expect(countWords("  hello   world  ")).toBe(2);
    expect(countWords("one\ntwo\tthree   four")).toBe(4);
  });

  it("treats Unicode whitespace as a separator", () => {
    expect(countWords("a b")).toBe(2); // non-breaking space
    expect(countWords("你好 世界")).toBe(2);
  });
});
