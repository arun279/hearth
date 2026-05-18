import { describe, expect, it } from "vitest";
import {
  assertDisplayOrderIsTopoSort,
  assertEdgePartIdsExist,
  assertNoDuplicateLibraryRefs,
  assertNoDuplicatePartIds,
  assertPartLibraryRefMimeMatch,
  assertWindowConsistent,
} from "../../src/activity/invariants.ts";
import type { ActivityFlow, ActivityWindow, PostClosePolicy } from "../../src/activity/types.ts";
import type { LibraryDisplayKind } from "../../src/library/types.ts";
import type { ActivityPart } from "../../src/parts/index.ts";

const reflectionPart = (id: string): ActivityPart => ({
  kind: "write_reflection",
  id,
  prompt: "Reflect.",
});

const readPart = (id: string, libraryItemId: string): ActivityPart => ({
  kind: "read_library_item",
  id,
  libraryItemId,
});

const audioPart = (id: string, libraryItemId: string): ActivityPart => ({
  kind: "listen_audio",
  id,
  libraryItemId,
});

const videoPart = (id: string, libraryItemId: string): ActivityPart => ({
  kind: "watch_video",
  id,
  libraryItemId,
});

describe("assertNoDuplicatePartIds", () => {
  it("accepts unique ids", () => {
    expect(assertNoDuplicatePartIds([reflectionPart("a"), reflectionPart("b")]).ok).toBe(true);
  });
  it("rejects duplicate ids", () => {
    const r = assertNoDuplicatePartIds([reflectionPart("a"), reflectionPart("a")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("duplicate_part_id");
  });
});

describe("assertEdgePartIdsExist", () => {
  const parts = [reflectionPart("a"), reflectionPart("b"), reflectionPart("c")];
  it("accepts edges among present ids", () => {
    const flow: ActivityFlow = {
      prereqs: [{ fromPartId: "a", toPartId: "b", kind: "hard" }],
    };
    expect(assertEdgePartIdsExist(flow, parts).ok).toBe(true);
  });
  it("rejects edges referencing unknown ids", () => {
    const flow: ActivityFlow = {
      prereqs: [{ fromPartId: "a", toPartId: "z", kind: "hard" }],
    };
    const r = assertEdgePartIdsExist(flow, parts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unknown_part_id_in_flow");
  });
  it("rejects displayOrder referencing unknown ids", () => {
    const flow: ActivityFlow = { prereqs: [], displayOrder: ["a", "b", "z"] };
    const r = assertEdgePartIdsExist(flow, parts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unknown_part_id_in_flow");
  });
});

describe("assertDisplayOrderIsTopoSort", () => {
  const parts = [reflectionPart("a"), reflectionPart("b"), reflectionPart("c")];

  it("returns ok when displayOrder is absent", () => {
    expect(assertDisplayOrderIsTopoSort({ prereqs: [] } as ActivityFlow, parts).ok).toBe(true);
  });

  it("rejects displayOrder of wrong length", () => {
    const r = assertDisplayOrderIsTopoSort(
      { prereqs: [], displayOrder: ["a", "b"] } as ActivityFlow,
      parts,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects displayOrder containing duplicates", () => {
    const r = assertDisplayOrderIsTopoSort(
      { prereqs: [], displayOrder: ["a", "a", "b"] } as ActivityFlow,
      parts,
    );
    expect(r.ok).toBe(false);
  });

  it("accepts a topo sort", () => {
    const flow: ActivityFlow = {
      prereqs: [{ fromPartId: "a", toPartId: "b", kind: "hard" }],
      displayOrder: ["a", "b", "c"],
    };
    expect(assertDisplayOrderIsTopoSort(flow, parts).ok).toBe(true);
  });

  it("rejects an order that violates a hard edge", () => {
    const flow: ActivityFlow = {
      prereqs: [{ fromPartId: "a", toPartId: "b", kind: "hard" }],
      displayOrder: ["b", "a", "c"],
    };
    const r = assertDisplayOrderIsTopoSort(flow, parts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("display_order_not_topo");
  });

  it("does not require ordering for soft edges", () => {
    const flow: ActivityFlow = {
      prereqs: [{ fromPartId: "a", toPartId: "b", kind: "soft" }],
      displayOrder: ["b", "a", "c"],
    };
    expect(assertDisplayOrderIsTopoSort(flow, parts).ok).toBe(true);
  });
});

describe("assertWindowConsistent — full truth table", () => {
  const NULL_WINDOW: ActivityWindow = { opensAt: null, dueAt: null, closesAt: null };
  const T1 = 1_745_452_800_000;
  const T2 = 1_745_625_600_000;
  const T3 = 1_745_798_400_000;
  const HIDDEN: PostClosePolicy = { kind: "hidden" };

  it("ok: no window, no post-close", () => {
    expect(assertWindowConsistent(null, null).ok).toBe(true);
  });
  it("rejects post-close without a window", () => {
    expect(assertWindowConsistent(null, HIDDEN).ok).toBe(false);
  });
  it("ok: empty window, no post-close", () => {
    expect(assertWindowConsistent(NULL_WINDOW, null).ok).toBe(true);
  });
  it("ok: closesAt set with post-close", () => {
    expect(assertWindowConsistent({ opensAt: null, dueAt: null, closesAt: T1 }, HIDDEN).ok).toBe(
      true,
    );
  });
  it("rejects closesAt set without post-close", () => {
    expect(assertWindowConsistent({ opensAt: null, dueAt: null, closesAt: T1 }, null).ok).toBe(
      false,
    );
  });
  it("rejects post-close set without closesAt", () => {
    expect(assertWindowConsistent({ opensAt: T1, dueAt: T2, closesAt: null }, HIDDEN).ok).toBe(
      false,
    );
  });
  it("ok: monotonic open ≤ due ≤ close", () => {
    expect(assertWindowConsistent({ opensAt: T1, dueAt: T2, closesAt: T3 }, HIDDEN).ok).toBe(true);
  });
  it("rejects open > due", () => {
    expect(assertWindowConsistent({ opensAt: T2, dueAt: T1, closesAt: null }, null).ok).toBe(false);
  });
  it("rejects due > close", () => {
    expect(assertWindowConsistent({ opensAt: null, dueAt: T3, closesAt: T2 }, HIDDEN).ok).toBe(
      false,
    );
  });
  it("rejects open > close", () => {
    expect(assertWindowConsistent({ opensAt: T3, dueAt: null, closesAt: T2 }, HIDDEN).ok).toBe(
      false,
    );
  });
});

describe("assertPartLibraryRefMimeMatch", () => {
  const buildKindMap = (entries: Array<[string, LibraryDisplayKind]>) => new Map(entries);

  it("accepts a read part referencing a pdf", () => {
    expect(
      assertPartLibraryRefMimeMatch([readPart("p1", "li_pdf")], buildKindMap([["li_pdf", "pdf"]]))
        .ok,
    ).toBe(true);
  });

  it("rejects a read part referencing a video", () => {
    const r = assertPartLibraryRefMimeMatch(
      [readPart("p1", "li_video")],
      buildKindMap([["li_video", "video"]]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("part_library_mime_mismatch");
  });

  it("rejects a listen part referencing a pdf", () => {
    const r = assertPartLibraryRefMimeMatch(
      [audioPart("p1", "li_pdf")],
      buildKindMap([["li_pdf", "pdf"]]),
    );
    expect(r.ok).toBe(false);
  });

  it("accepts a watch part referencing a video", () => {
    expect(
      assertPartLibraryRefMimeMatch(
        [videoPart("p1", "li_video")],
        buildKindMap([["li_video", "video"]]),
      ).ok,
    ).toBe(true);
  });

  it("rejects a part referencing an unknown library item", () => {
    const r = assertPartLibraryRefMimeMatch([readPart("p1", "missing")], new Map());
    expect(r.ok).toBe(false);
  });

  it("ignores parts that do not reference a library item", () => {
    expect(assertPartLibraryRefMimeMatch([reflectionPart("p1")], new Map()).ok).toBe(true);
  });
});

describe("assertNoDuplicateLibraryRefs", () => {
  it("ok on unique refs", () => {
    expect(assertNoDuplicateLibraryRefs([{ libraryItemId: "a" }, { libraryItemId: "b" }]).ok).toBe(
      true,
    );
  });
  it("rejects duplicates", () => {
    const r = assertNoDuplicateLibraryRefs([{ libraryItemId: "a" }, { libraryItemId: "a" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("duplicate_library_ref");
  });
});
