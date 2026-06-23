import type { ActivityPart } from "@hearth/domain";
import { describe, expect, it } from "vitest";
import { partMeasure } from "./part-measure.ts";

/**
 * The two-tier measure is the keystone of the player's content-width fix: text
 * Parts must cap at the narrow reading measure, media Parts at the wider one.
 * A wrong mapping silently re-introduces the off-canon column width the fix
 * exists to remove, so the kind→tier table is pinned here rather than left to
 * visual review alone.
 */
const TEXT_PARTS: readonly ActivityPart[] = [
  { kind: "write_reflection", id: "r1", prompt: "Reflect" },
  { kind: "quiz", id: "q1", questions: [] },
  { kind: "attend_session", id: "s1", studySessionId: "ss1" },
];

const MEDIA_PARTS: readonly ActivityPart[] = [
  { kind: "read_library_item", id: "d1", libraryItemId: "li1" },
  { kind: "listen_audio", id: "a1", libraryItemId: "li2" },
  { kind: "watch_video", id: "v1", libraryItemId: "li3" },
  { kind: "embed", id: "e1", provider: "generic", url: "https://example.com" },
];

describe("partMeasure", () => {
  it("caps text Parts at the narrow reading measure (max-w-2xl)", () => {
    for (const part of TEXT_PARTS) {
      expect(partMeasure(part)).toBe("max-w-2xl");
    }
  });

  it("uses the wider media measure (max-w-3xl) for document/audio/video/embed Parts", () => {
    for (const part of MEDIA_PARTS) {
      expect(partMeasure(part)).toBe("max-w-3xl");
    }
  });
});
