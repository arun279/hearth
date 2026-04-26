import { describe, expect, it } from "vitest";
import { CONTRIBUTION_MODE_COPY, DEFAULT_CONTRIBUTION_POLICY } from "../src/contribution-policy.ts";
import type { ContributionMode } from "../src/track.ts";
import { EMPTY_TRACK_STRUCTURE } from "../src/track-structure.ts";

const ALL_MODES: readonly ContributionMode[] = [
  "direct",
  "optional_review",
  "required_review",
  "none",
];

describe("EMPTY_TRACK_STRUCTURE", () => {
  it("is a v:1 envelope with mode 'free'", () => {
    expect(EMPTY_TRACK_STRUCTURE).toEqual({ v: 1, data: { mode: "free" } });
  });
});

describe("DEFAULT_CONTRIBUTION_POLICY", () => {
  it("is a v:1 envelope with mode 'direct'", () => {
    expect(DEFAULT_CONTRIBUTION_POLICY).toEqual({ v: 1, data: { mode: "direct" } });
  });
});

describe("CONTRIBUTION_MODE_COPY", () => {
  it.each(ALL_MODES)("has a label + hint entry for %s", (mode) => {
    const entry = CONTRIBUTION_MODE_COPY[mode];
    expect(entry).toBeDefined();
    expect(typeof entry.label).toBe("string");
    expect(entry.label.length).toBeGreaterThan(0);
    expect(typeof entry.hint).toBe("string");
    expect(entry.hint.length).toBeGreaterThan(0);
  });

  it("covers every ContributionMode (no gaps in the map)", () => {
    expect(Object.keys(CONTRIBUTION_MODE_COPY).sort()).toEqual([...ALL_MODES].sort());
  });
});
