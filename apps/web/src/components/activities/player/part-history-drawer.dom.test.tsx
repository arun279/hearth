import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFetchSpy } from "../../../test/fetch-spy.ts";
import { renderWithProviders } from "../../../test/render.tsx";
import { PartHistoryDrawer } from "./part-history-drawer.tsx";

/**
 * The drawer's stateful branches that an SSR-string render can't reach: the
 * fetch-driven loading → data transition, the read-only snapshot render per Part
 * kind, the empty state, and the error split (404 neutral / 5xx danger+retry).
 * The responsive Modal-vs-Drawer swap is forced via a stubbed `matchMedia` so
 * both structural branches are exercised deterministically.
 */

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

function historyResponse(entries: unknown[]): Response {
  return new Response(JSON.stringify(entries), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function problem(status: number): Response {
  return new Response(JSON.stringify({ title: "x", status, detail: "x" }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

const REFLECTION_ENTRY = {
  id: "h1",
  activityRecordId: "rec1",
  partId: "p1",
  reason: "facilitator_reset",
  revisionIdAtTime: null,
  recordedAt: "2026-06-01T10:00:00.000Z",
  snapshot: { kind: "write_reflection", completed: true, text: "My earlier reflection" },
};

let fetchSpy: ReturnType<typeof installFetchSpy>;

beforeEach(() => {
  fetchSpy = installFetchSpy();
  stubMatchMedia(true);
});

afterEach(() => {
  fetchSpy.restore();
  vi.unstubAllGlobals();
});

function renderDrawer() {
  return renderWithProviders(
    <PartHistoryDrawer
      open
      onClose={vi.fn()}
      activityId="act1"
      partId="p1"
      partLabel="1. Reflection"
    />,
  );
}

describe("PartHistoryDrawer", () => {
  it("renders the loading state then each entry's reason, time, and read-only snapshot", async () => {
    fetchSpy.respondWith(historyResponse([REFLECTION_ENTRY]));
    renderDrawer();

    expect(screen.getByText("Loading history…")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Reset by a facilitator")).toBeInTheDocument());
    expect(screen.getByText("My earlier reflection")).toBeInTheDocument();
    // The snapshot is non-interactive — no edit affordances leak into history.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows the empty state when the part has no prior attempts", async () => {
    fetchSpy.respondWith(historyResponse([]));
    renderDrawer();

    await waitFor(() =>
      expect(screen.getByText("No prior attempts on this part yet.")).toBeInTheDocument(),
    );
  });

  it("splits the error branch: 404 is a neutral no-retry surface", async () => {
    fetchSpy.respondWith(problem(404));
    renderDrawer();

    await waitFor(() => expect(screen.getByText("History isn't available")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("splits the error branch: 5xx keeps a danger Callout with a retry that refetches", async () => {
    fetchSpy.respondWith(problem(503));
    const { user } = renderDrawer();

    await waitFor(() => expect(screen.getByText("Couldn't load history")).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: "Try again" });

    fetchSpy.respondWith(historyResponse([REFLECTION_ENTRY]));
    await user.click(retry);

    await waitFor(() => expect(screen.getByText("Reset by a facilitator")).toBeInTheDocument());
  });

  it("renders as an edge Sheet below md (matchMedia false)", async () => {
    stubMatchMedia(false);
    fetchSpy.respondWith(historyResponse([REFLECTION_ENTRY]));
    renderDrawer();

    // Both branches expose role=dialog and a close affordance; only the Sheet
    // branch carries the Drawer's intro paragraph (the Modal uses a `description`
    // prop instead), so it discriminates the structural swap.
    await waitFor(() =>
      expect(
        screen.getByText(/preserved whenever it's retried, reopened by a new revision/i),
      ).toBeInTheDocument(),
    );
  });
});
