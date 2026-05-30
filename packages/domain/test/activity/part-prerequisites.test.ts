import { describe, expect, it } from "vitest";
import { arePartPrerequisitesMet } from "../../src/activity/part-prerequisites.ts";
import type { ActivityFlow } from "../../src/activity/types.ts";

const flow: ActivityFlow = {
  prereqs: [
    { fromPartId: "read", toPartId: "quiz", kind: "hard" },
    { fromPartId: "intro", toPartId: "quiz", kind: "soft" },
  ],
};

describe("arePartPrerequisitesMet", () => {
  it("is met when no hard prerequisite gates the Part", () => {
    expect(arePartPrerequisitesMet(flow, "read", new Set())).toBe(true);
  });

  it("is unmet while a hard prerequisite is incomplete", () => {
    expect(arePartPrerequisitesMet(flow, "quiz", new Set())).toBe(false);
  });

  it("is met once every hard prerequisite is complete", () => {
    expect(arePartPrerequisitesMet(flow, "quiz", new Set(["read"]))).toBe(true);
  });

  it("ignores soft edges entirely", () => {
    // `intro` (soft) is incomplete but only `read` (hard) gates `quiz`.
    expect(arePartPrerequisitesMet(flow, "quiz", new Set(["read"]))).toBe(true);
  });
});
