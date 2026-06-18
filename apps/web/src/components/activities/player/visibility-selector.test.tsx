import type { VisibilityPreference } from "@hearth/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SELECTABLE_VISIBILITY_OVERRIDES,
  visibilityTriggerLabel,
} from "../../../lib/visibility-labels.ts";
import { VisibilitySelector } from "./visibility-selector.tsx";

/**
 * The visibility control is the privacy-bearing action of the milestone, so
 * its trigger-label resolution and the "no redundant default radio" invariant
 * are pinned here. The radios and the "Use my default" clear action live in a
 * Popover panel that mounts only after a client click + focus effect, neither
 * of which runs under `renderToString`; their behaviour is exercised by the
 * m10 e2e and lands in the deferred jsdom component-test layer (separate PR).
 *
 * TODO(m10.5): add jsdom component coverage for the deferred DOM behaviors —
 * the in-panel popover radios selecting a scope, and the "Use my default"
 * clear round-trip (override -> null reverts the trigger to the resolved
 * account default) including the SaveIndicator settling to "Saved".
 */

function render(value: VisibilityPreference | null): string {
  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <VisibilitySelector activityId="a_test" value={value} />
    </QueryClientProvider>,
  );
}

describe("visibilityTriggerLabel", () => {
  it("maps a null override to the resolved account default, not an opaque pointer", () => {
    expect(visibilityTriggerLabel(null)).toBe("Your default (Track)");
  });

  it("maps each concrete preference to its friendly label", () => {
    expect(visibilityTriggerLabel("default")).toBe("Track");
    expect(visibilityTriggerLabel("track_only")).toBe("Track only");
    expect(visibilityTriggerLabel("private")).toBe("Just me");
  });
});

describe("SELECTABLE_VISIBILITY_OVERRIDES", () => {
  it("offers only the concrete scopes — `default` is reachable solely by clearing the override", () => {
    expect([...SELECTABLE_VISIBILITY_OVERRIDES]).toEqual(["track_only", "private"]);
  });
});

describe("<VisibilitySelector> trigger", () => {
  it("shows the resolved default label when there is no override", () => {
    expect(render(null)).toContain("Your default (Track)");
  });

  it("shows the chosen scope's label when an override is set", () => {
    expect(render("private")).toContain("Just me");
    expect(render("track_only")).toContain("Track only");
  });
});
