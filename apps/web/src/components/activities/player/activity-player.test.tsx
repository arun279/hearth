import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityPlayer } from "./activity-player.tsx";

/**
 * Server-side render coverage for `<ActivityPlayer>`'s ErrorState
 * branches. The 404 branch is exercised end-to-end in the Playwright
 * spec (a route walks the real fetch path and asserts the rendered
 * copy); the 5xx / network branch belongs here because the e2e suite
 * has no good way to force a real backend 500.
 *
 * The branch matters: a 404 is permanent (audience exclusion / missing
 * / post-close hidden) and retry recovers nothing, so the surface is a
 * neutral callout with no inline retry. A 5xx is transient and retry IS
 * meaningful, so the surface is a danger callout WITH a "Try again"
 * button. Conflating the two leaks an enumeration oracle on 404 OR
 * hides recovery on 5xx; the test pins both invariants at the SSR seam.
 */

function noop() {
  /* no-op */
}

describe("<ActivityPlayer> ErrorState", () => {
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
});
