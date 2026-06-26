import { describe, expect, it } from "vitest";
import {
  VISIBILITY_PREFERENCES,
  visibilityPreferenceEnvelopeSchema,
  visibilityPreferenceSchema,
} from "../../src/visibility/preference.ts";

describe("visibility preference", () => {
  it("enumerates exactly the three canonical wire values", () => {
    expect([...VISIBILITY_PREFERENCES]).toEqual(["default", "track_only", "private"]);
  });

  it("accepts each canonical preference and rejects anything else", () => {
    for (const p of VISIBILITY_PREFERENCES) {
      expect(visibilityPreferenceSchema.parse(p)).toBe(p);
    }
    expect(visibilityPreferenceSchema.safeParse("facilitators_only").success).toBe(false);
    expect(visibilityPreferenceSchema.safeParse("").success).toBe(false);
  });

  it("parses a well-formed v1 override envelope", () => {
    const env = visibilityPreferenceEnvelopeSchema.parse({ v: 1, data: { preference: "private" } });
    expect(env.data.preference).toBe("private");
  });

  it("rejects an envelope with a wrong version or an unknown preference", () => {
    expect(
      visibilityPreferenceEnvelopeSchema.safeParse({ v: 2, data: { preference: "private" } })
        .success,
    ).toBe(false);
    expect(
      visibilityPreferenceEnvelopeSchema.safeParse({ v: 1, data: { preference: "nope" } }).success,
    ).toBe(false);
  });
});
