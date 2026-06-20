import type { WriteReflectionPart } from "@hearth/domain";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../../lib/api-client.ts";
import { installFetchSpy } from "../../../../test/fetch-spy.ts";
import { renderWithProviders } from "../../../../test/render.tsx";

/**
 * The stateful autosave behaviour an SSR-string test can't drive: the
 * debounced pill transitions, retry routing through the same persist path,
 * the monotonic `lastSaved` advance under a dual writer, and the
 * visibilitychange / unmount keepalive flush (plus its no-pending-change skip).
 *
 * `useSaveReflection` is mocked so the test owns the mutation's resolution and
 * can assert that retry re-invokes the same persist call; the keepalive flush
 * uses the GLOBAL fetch seam directly, so `installFetchSpy` observes its PUT.
 */

// The save mutation is a real `useMutation` wired to a controllable
// `mutationFn`, so the test drives genuine isPending -> isSuccess/isError
// transitions (and the re-renders they schedule) while still asserting the
// exact persist calls. The retry-disabled QueryClient from the harness means
// the error branch settles on the first rejection.
const mutationFn = vi.fn<(input: { partId: string; text: string }) => Promise<void>>();

vi.mock("../../../../hooks/use-activity-record.ts", async () => {
  const rq = await import("@tanstack/react-query");
  return {
    useSaveReflection: () => rq.useMutation({ mutationFn }),
  };
});

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

// The record-level visibility control is its own tested surface; stub it so a
// reflect-part test asserts only the autosave behaviour.
vi.mock("../visibility-selector.tsx", () => ({
  VisibilitySelector: () => null,
}));

import { ReflectPart } from "./reflect-part.tsx";

const PART: WriteReflectionPart = { kind: "write_reflection", id: "p_reflect", prompt: "Why?" };

function renderEditor() {
  return renderWithProviders(
    <ReflectPart
      activityId="a_test"
      part={PART}
      partState={null}
      canParticipate={true}
      visibilityOverride={null}
    />,
  );
}

// A file-wide global-fetch spy intercepts the keepalive flush so its raw
// `fetch(url, { keepalive })` (fired on every editor cleanup) never attempts a
// real connection; the flush-specific tests assert against it.
let fetchSpy: ReturnType<typeof installFetchSpy>;

beforeEach(() => {
  mutationFn.mockReset();
  mutationFn.mockResolvedValue(undefined);
  toastError.mockReset();
  fetchSpy = installFetchSpy();
});

afterEach(() => {
  // Unmount any still-mounted editor while the spy is still installed: the
  // unmount keepalive flush issues a raw `fetch`, and letting RTL's own
  // afterEach cleanup run it after the spy is restored would hit a real socket.
  cleanup();
  fetchSpy.restore();
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});

describe("ReflectPart autosave debounce", () => {
  it("coalesces a typing burst into a single debounced persist after the pause", async () => {
    vi.useFakeTimers();
    try {
      renderEditor();
      const textarea = screen.getByRole("textbox", { name: "Your reflection" });

      // Three rapid edits inside the 800ms window — `fireEvent` instead of
      // userEvent so the fake clock is the only time source.
      act(() => {
        fireEvent.change(textarea, { target: { value: "h" } });
      });
      act(() => {
        vi.advanceTimersByTime(300);
        fireEvent.change(textarea, { target: { value: "ho" } });
      });
      act(() => {
        vi.advanceTimersByTime(300);
        fireEvent.change(textarea, { target: { value: "hola" } });
      });
      expect(mutationFn).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(800);
      });

      expect(mutationFn).toHaveBeenCalledTimes(1);
      expect(mutationFn.mock.calls[0]?.[0]).toEqual({ partId: "p_reflect", text: "hola" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows Saving while dirty, then Saved once the debounced save resolves, and never re-persists an unchanged value", async () => {
    renderEditor();
    const textarea = screen.getByRole("textbox", { name: "Your reflection" });

    act(() => {
      fireEvent.change(textarea, { target: { value: "hi" } });
    });
    // Dirty edits read as "Saving…" before the debounce fires.
    expect(screen.getByText("Saving…")).toBeInTheDocument();

    // Real timers + the resolved mutationFn let RQ flip isSuccess, which the
    // pill reads once the save settles.
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect(mutationFn.mock.calls[0]?.[0]).toEqual({ partId: "p_reflect", text: "hi" });
  });
});

describe("ReflectPart retry", () => {
  it("routes the retry affordance through the same persist call as the autosave", async () => {
    mutationFn.mockRejectedValue(new Error("offline"));
    const { user } = renderEditor();
    const textarea = screen.getByRole("textbox", { name: "Your reflection" });
    await user.type(textarea, "x");

    const retry = await screen.findByRole("button", { name: "retry" });
    mutationFn.mockClear();
    await user.click(retry);

    await waitFor(() => expect(mutationFn).toHaveBeenCalledTimes(1));
    expect(mutationFn.mock.calls[0]?.[0]).toEqual({ partId: "p_reflect", text: "x" });
  });

  it("toasts only once across a failure burst", async () => {
    mutationFn.mockRejectedValue(new Error("offline"));
    const { user } = renderEditor();
    const textarea = screen.getByRole("textbox", { name: "Your reflection" });
    await user.type(textarea, "x");
    const retry = await screen.findByRole("button", { name: "retry" });
    await user.click(retry);
    await user.click(retry);

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
  });
});

describe("ReflectPart keepalive flush", () => {
  it("flushes a pending draft via a keepalive PUT when the tab is hidden", async () => {
    const { user } = renderEditor();
    const textarea = screen.getByRole("textbox", { name: "Your reflection" });
    await user.type(textarea, "draft");
    fetchSpy.spy.mockClear();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(fetchSpy.spy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.init(0)?.method).toBe("PUT");
    expect(fetchSpy.init(0)?.keepalive).toBe(true);
    expect(fetchSpy.init(0)?.body).toBe(JSON.stringify({ text: "draft" }));
    // Assert against the same typed `$url` the component builds, so the check
    // tracks the route surface instead of a hand-written path that can drift.
    const expectedUrl = api.activities[":activityId"]["my-record"].parts[":partId"].reflection.$url(
      { param: { activityId: "a_test", partId: "p_reflect" } },
    );
    expect(new URL(fetchSpy.url(0)).pathname).toBe(expectedUrl.pathname);
  });

  it("flushes the pending draft on unmount", async () => {
    const { user, unmount } = renderEditor();
    const textarea = screen.getByRole("textbox", { name: "Your reflection" });
    await user.type(textarea, "bye");
    fetchSpy.spy.mockClear();

    unmount();

    expect(fetchSpy.spy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.init(0)?.keepalive).toBe(true);
  });

  it("skips the flush when nothing new is pending (textRef === lastSaved)", async () => {
    const { unmount } = renderEditor();
    // No typing: the live text still equals the seed, so the unmount flush
    // must early-return rather than fire a no-op PUT.
    unmount();
    expect(fetchSpy.spy).not.toHaveBeenCalled();
  });

  it("does not re-flush after a keepalive flush already persisted the latest text (monotonic lastSaved)", async () => {
    const { user, unmount } = renderEditor();
    const textarea = screen.getByRole("textbox", { name: "Your reflection" });
    await user.type(textarea, "once");
    fetchSpy.spy.mockClear();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(fetchSpy.spy).toHaveBeenCalledTimes(1));

    // The flush advanced `lastSaved` to the live text; the unmount flush must
    // now see textRef === lastSaved and skip — no second PUT for stale text.
    unmount();
    expect(fetchSpy.spy).toHaveBeenCalledTimes(1);
  });
});
