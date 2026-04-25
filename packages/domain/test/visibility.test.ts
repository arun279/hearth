import { describe, expect, it } from "vitest";
import { defaultVisibilityScope } from "../src/visibility/index.ts";

describe("defaultVisibilityScope", () => {
  it("returns track + detail — what a new participant sees by default before any preference is set", () => {
    expect(defaultVisibilityScope()).toEqual({ audience: "track", level: "detail" });
  });
});
