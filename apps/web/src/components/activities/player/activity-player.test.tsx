import { isValidElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ActivityPlayer, ErrorState } from "./activity-player.tsx";

/**
 * Coverage for `<ActivityPlayer>`'s 5xx / network ErrorState branch.
 * The 404 branch is exercised end-to-end in the Playwright spec (a
 * real fetch path returns 404 and the route renders the neutral
 * callout); the 5xx branch belongs here because the e2e suite has no
 * good way to force a real backend 500.
 *
 * Two invariants live in this branch and both need to be pinned:
 *
 *   1. The danger callout copy + "Try again" button RENDER. Conflating
 *      this with the 404 branch hides recovery on transient failures.
 *      Asserted via SSR — the rendered HTML carries the strings.
 *   2. The "Try again" button's `onClick` is wired to the `refetch`
 *      handler passed in via `query`. SSR drops handlers, so this
 *      invariant is checked by walking the React element tree returned
 *      from `ErrorState({…})` directly. A typo (`onClick={() => {}}`)
 *      would compile, render the same HTML, and silently break retry —
 *      the e2e doesn't catch that because the click is fired but the
 *      handler is a no-op.
 */

function noop() {
  /* no-op */
}

function findElement(node: unknown, predicate: (el: ReactElement) => boolean): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (predicate(node)) return node;
  const children = (node.props as { children?: unknown }).children;
  return children === undefined ? null : findElement(children, predicate);
}

describe("<ActivityPlayer> ErrorState (5xx / network branch)", () => {
  it("renders the danger callout + Try again on a non-ApiError (network failure)", () => {
    const html = renderToString(
      <ActivityPlayer
        query={{
          isLoading: false,
          isError: true,
          error: new Error("fetch failed"),
          refetch: noop,
        }}
        requestedPartId={null}
        onChangeActivePartId={noop}
      />,
    );
    expect(html).toContain("Couldn&#x27;t open this activity");
    expect(html).toContain("Try again");
    expect(html).not.toContain("This activity isn&#x27;t available");
  });

  it("wires the Try again button's onClick to the provided onRetry", () => {
    // Call the pure function component directly to introspect its
    // returned React element tree — no DOM needed, no testing-library
    // dependency. Identity comparison is the strongest possible
    // wiring assertion: only the actual `onRetry` reference passes.
    const onRetry = vi.fn();
    const tree = ErrorState({ error: new Error("boom"), onRetry });
    const button = findElement(
      tree,
      (el) => (el.props as { onClick?: unknown }).onClick === onRetry,
    );
    expect(button, "no element bound `onClick` to `onRetry`").not.toBeNull();
  });
});
