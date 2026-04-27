import { describe, expect, it } from "vitest";
import type { TrackStatus } from "../src/track.ts";
import { canTransitionTrackTo, legalTrackTransitionsFrom } from "../src/track-transitions.ts";

const STATUSES: readonly TrackStatus[] = ["active", "paused", "archived"];

// Truth table — rows are FROM, columns are TO. true ↔ legal flip OR identity.
const EXPECTED: Readonly<Record<TrackStatus, Readonly<Record<TrackStatus, boolean>>>> = {
  active: { active: true, paused: true, archived: true },
  paused: { active: true, paused: true, archived: true },
  archived: { active: false, paused: false, archived: true },
};

describe("canTransitionTrackTo", () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const expected = EXPECTED[from][to];
      it(`${from} → ${to} === ${expected}`, () => {
        expect(canTransitionTrackTo(from, to)).toBe(expected);
      });
    }
  }

  it("is idempotent on the same status (active → active)", () => {
    expect(canTransitionTrackTo("active", "active")).toBe(true);
  });
  it("is idempotent on the same status (paused → paused)", () => {
    expect(canTransitionTrackTo("paused", "paused")).toBe(true);
  });
  it("is idempotent on the same status (archived → archived)", () => {
    expect(canTransitionTrackTo("archived", "archived")).toBe(true);
  });
});

describe("legalTrackTransitionsFrom", () => {
  it("returns [paused, archived] from active", () => {
    expect(legalTrackTransitionsFrom("active")).toEqual(["paused", "archived"]);
  });

  it("returns [active, archived] from paused", () => {
    expect(legalTrackTransitionsFrom("paused")).toEqual(["active", "archived"]);
  });

  it("returns an empty array from archived (terminal)", () => {
    expect(legalTrackTransitionsFrom("archived")).toEqual([]);
  });
});
