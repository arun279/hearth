import { describe, expect, it } from "vitest";
import type { ActivityPart } from "../../src/parts/index.ts";
import { affectedPartIdsForRevisionBump } from "../../src/record/affected-parts.ts";

const parts: ActivityPart[] = [
  { kind: "read_library_item", id: "p_read", libraryItemId: "li_doc" },
  { kind: "listen_audio", id: "p_listen", libraryItemId: "li_audio" },
  { kind: "read_library_item", id: "p_read2", libraryItemId: "li_doc" },
  { kind: "write_reflection", id: "p_reflect", prompt: "Why?" },
];

const activity = {
  parts,
  libraryRefs: [
    { libraryItemId: "li_doc", pinnedRevisionId: null },
    { libraryItemId: "li_audio", pinnedRevisionId: "rev_pinned" },
  ],
};

describe("affectedPartIdsForRevisionBump", () => {
  it("returns every unpinned Part that references the bumped item", () => {
    expect(affectedPartIdsForRevisionBump(activity, "li_doc")).toEqual(["p_read", "p_read2"]);
  });

  it("returns nothing for a pinned ref — a pin freezes the Part against the bump", () => {
    expect(affectedPartIdsForRevisionBump(activity, "li_audio")).toEqual([]);
  });

  it("returns nothing for an item the activity does not reference", () => {
    expect(affectedPartIdsForRevisionBump(activity, "li_unknown")).toEqual([]);
  });
});
