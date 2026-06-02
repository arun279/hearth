import { describe, expect, it } from "vitest";
import { computeActivityAccessState } from "../../src/activity/access-state.ts";
import type { ActivityWindow, PostClosePolicy } from "../../src/activity/types.ts";

/**
 * Truth-table coverage for `computeActivityAccessState`. The function is
 * the single source of truth for how an activity's window + post-close
 * policy combine into the four-state union the player surface consumes.
 * Test inputs are explicit numeric epochs so a reader can reason about
 * the boundary at-equality vs strictly-past cases without parsing dates.
 */

const T_OPENS = 1_000;
const T_DUE = 2_000;
const T_CLOSES = 3_000;

function win(
  opensAt: number | null,
  dueAt: number | null,
  closesAt: number | null,
): ActivityWindow {
  return { opensAt, dueAt, closesAt };
}

const HIDDEN: PostClosePolicy = { kind: "hidden" };
const LOCKED: PostClosePolicy = { kind: "visible_locked" };
const COMPLETABLE: PostClosePolicy = { kind: "visible_completable" };

describe("computeActivityAccessState — no window", () => {
  it("returns 'open' when window is null (no constraints)", () => {
    expect(computeActivityAccessState(null, null, new Date(0))).toBe("open");
  });
});

describe("computeActivityAccessState — pre-open transition", () => {
  it("returns 'pre_open' strictly before opensAt", () => {
    expect(computeActivityAccessState(win(T_OPENS, null, null), null, new Date(T_OPENS - 1))).toBe(
      "pre_open",
    );
  });

  it("returns 'open' at opensAt (inclusive)", () => {
    expect(computeActivityAccessState(win(T_OPENS, null, null), null, new Date(T_OPENS))).toBe(
      "open",
    );
  });

  it("returns 'open' after opensAt", () => {
    expect(computeActivityAccessState(win(T_OPENS, null, null), null, new Date(T_OPENS + 1))).toBe(
      "open",
    );
  });

  it("ignores opensAt when it is null even with other fields set", () => {
    expect(
      computeActivityAccessState(win(null, T_DUE, T_CLOSES), HIDDEN, new Date(T_DUE - 1)),
    ).toBe("open");
  });
});

describe("computeActivityAccessState — post-close × policy", () => {
  it("returns 'hidden' when policy is hidden and now > closesAt", () => {
    expect(
      computeActivityAccessState(win(null, null, T_CLOSES), HIDDEN, new Date(T_CLOSES + 1)),
    ).toBe("hidden");
  });

  it("returns 'locked' when policy is visible_locked and now > closesAt", () => {
    expect(
      computeActivityAccessState(win(null, null, T_CLOSES), LOCKED, new Date(T_CLOSES + 1)),
    ).toBe("locked");
  });

  it("returns 'open' when policy is visible_completable and now > closesAt", () => {
    expect(
      computeActivityAccessState(win(null, null, T_CLOSES), COMPLETABLE, new Date(T_CLOSES + 1)),
    ).toBe("open");
  });

  it("stays 'open' at closesAt (inclusive — the close instant has not passed)", () => {
    expect(computeActivityAccessState(win(null, null, T_CLOSES), HIDDEN, new Date(T_CLOSES))).toBe(
      "open",
    );
  });

  it("stays 'open' before closesAt regardless of policy", () => {
    expect(
      computeActivityAccessState(win(null, null, T_CLOSES), HIDDEN, new Date(T_CLOSES - 1)),
    ).toBe("open");
    expect(
      computeActivityAccessState(win(null, null, T_CLOSES), LOCKED, new Date(T_CLOSES - 1)),
    ).toBe("open");
    expect(
      computeActivityAccessState(win(null, null, T_CLOSES), COMPLETABLE, new Date(T_CLOSES - 1)),
    ).toBe("open");
  });
});

describe("computeActivityAccessState — pre-open precedes post-close", () => {
  it("returns 'pre_open' even when closesAt is also in the future", () => {
    expect(
      computeActivityAccessState(win(T_OPENS, T_DUE, T_CLOSES), HIDDEN, new Date(T_OPENS - 1)),
    ).toBe("pre_open");
  });
});

describe("computeActivityAccessState — invariant: hidden requires hidden policy", () => {
  it("never returns 'hidden' without a hidden post-close policy", () => {
    expect(
      computeActivityAccessState(win(null, null, T_CLOSES), LOCKED, new Date(T_CLOSES + 100_000)),
    ).not.toBe("hidden");
    expect(
      computeActivityAccessState(
        win(null, null, T_CLOSES),
        COMPLETABLE,
        new Date(T_CLOSES + 100_000),
      ),
    ).not.toBe("hidden");
  });
});
