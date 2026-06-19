import type { VisibilityPreference } from "@hearth/domain";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFetchSpy } from "../../../test/fetch-spy.ts";
import { renderWithProviders } from "../../../test/render.tsx";

/**
 * The popover-driven behaviour an SSR-string test can't reach: the radios and
 * the "Use my default" clear action mount only after a client click + the
 * Popover's focus effect. The override-set mutation is a real `useMutation`
 * over a controllable `mutationFn` so the test owns its resolution and drives
 * the genuine in-panel SaveIndicator transition.
 */

const setVisibilityFn =
  vi.fn<(preference: VisibilityPreference | null) => Promise<{ visibilityOverride: unknown }>>();

vi.mock("../../../hooks/use-activity-record.ts", async () => {
  const rq = await import("@tanstack/react-query");
  return {
    useSetRecordVisibility: () => rq.useMutation({ mutationFn: setVisibilityFn }),
  };
});

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

import { VisibilitySelector } from "./visibility-selector.tsx";

let fetchSpy: ReturnType<typeof installFetchSpy>;

beforeEach(() => {
  setVisibilityFn.mockReset();
  setVisibilityFn.mockResolvedValue({ visibilityOverride: null });
  toastError.mockReset();
  fetchSpy = installFetchSpy();
});

afterEach(() => {
  fetchSpy.restore();
});

function renderSelector(value: VisibilityPreference | null) {
  return renderWithProviders(<VisibilitySelector activityId="a_test" value={value} />);
}

describe("VisibilitySelector popover radios", () => {
  it("mounts the radios on the first trigger click and sends the chosen scope", async () => {
    const { user } = renderSelector(null);
    // The panel (and its radios) are absent until the trigger opens it.
    expect(screen.queryByRole("radio", { name: /Track only/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Visibility:/ }));
    await user.click(await screen.findByRole("radio", { name: /Track only/ }));

    await waitFor(() => expect(setVisibilityFn).toHaveBeenCalledTimes(1));
    expect(setVisibilityFn.mock.calls[0]?.[0]).toBe("track_only");
  });

  it("settles the in-panel SaveIndicator to Saved after the mutation resolves", async () => {
    const { user } = renderSelector(null);
    await user.click(screen.getByRole("button", { name: /Visibility:/ }));
    await user.click(await screen.findByRole("radio", { name: /Just me/ }));

    expect(setVisibilityFn.mock.calls[0]?.[0]).toBe("private");
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });
});

describe("VisibilitySelector 'Use my default' clear", () => {
  it("clears the override (null) when an override is set, and is absent with no override", async () => {
    const { user } = renderSelector("track_only");
    await user.click(screen.getByRole("button", { name: /Visibility:/ }));

    const clear = await screen.findByRole("button", { name: /Use my default/ });
    await user.click(clear);

    await waitFor(() => expect(setVisibilityFn).toHaveBeenCalledTimes(1));
    // Clearing sends `null` — the override -> account-default round-trip.
    expect(setVisibilityFn.mock.calls[0]?.[0]).toBeNull();
  });

  it("offers no clear action when there is no override to clear", async () => {
    const { user } = renderSelector(null);
    await user.click(screen.getByRole("button", { name: /Visibility:/ }));
    // The radios are present, but the clear affordance is gated on value !== null.
    await screen.findByRole("radio", { name: /Track only/ });
    expect(screen.queryByRole("button", { name: /Use my default/ })).not.toBeInTheDocument();
  });
});
