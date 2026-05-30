import { describe, expect, it } from "vitest";
import { countWords } from "../../src/parts/word-count.ts";

describe("countWords", () => {
  it("is zero for empty and whitespace-only input", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t ")).toBe(0);
  });

  it("counts single words and collapses runs of whitespace", () => {
    expect(countWords("hello")).toBe(1);
    expect(countWords("  hello   world  ")).toBe(2);
    expect(countWords("one\ntwo\tthree")).toBe(3);
  });

  it("counts unicode-separated words", () => {
    expect(countWords("café crème brûlée")).toBe(3);
  });
});
