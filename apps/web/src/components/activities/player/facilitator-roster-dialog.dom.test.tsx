import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFetchSpy } from "../../../test/fetch-spy.ts";
import { renderWithProviders } from "../../../test/render.tsx";
import { FacilitatorRosterDialog } from "./facilitator-roster-dialog.tsx";

/**
 * The roster dialog's stateful branches e2e can't economically reach: the
 * fetch-driven roster render, the reset confirm → optimistic in-place update
 * (the reset participant's prior-attempt count climbs and completion resets
 * from the returned full view, no refetch), and the error split (403 neutral /
 * 5xx danger+retry).
 */

function roster(entries: unknown[]): Response {
  return new Response(JSON.stringify({ entries }), {
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

const ROW = {
  recordId: "rec1",
  participantId: "u1",
  displayName: "Ada Lovelace",
  completionState: "completed",
  completedAt: "2026-06-01T10:00:00.000Z",
  partHistoryCount: 0,
};

// The full view the reset POST returns: completion reset, history climbed.
const RESET_FULL_VIEW = {
  id: "rec1",
  activityId: "act1",
  participantId: "u1",
  completionState: "in_progress",
  completedAt: null,
  visibilityOverride: null,
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-06-02T00:00:00.000Z",
  parts: [],
  partHistoryCount: 3,
  partsWithHistory: ["p1"],
};

let fetchSpy: ReturnType<typeof installFetchSpy>;

beforeEach(() => {
  fetchSpy = installFetchSpy();
});

afterEach(() => {
  fetchSpy.restore();
});

function renderDialog() {
  return renderWithProviders(
    <FacilitatorRosterDialog
      open
      onClose={vi.fn()}
      activityId="act1"
      activityTitle="Intro reading"
    />,
    { withToaster: true },
  );
}

describe("FacilitatorRosterDialog", () => {
  it("renders the roster after loading, with completion state per participant", async () => {
    fetchSpy.respondWith(roster([ROW]));
    renderDialog();

    expect(screen.getByText("Loading participants…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeInTheDocument());
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("confirms a reset and updates the row in place from the returned full view", async () => {
    fetchSpy.respondWith(roster([ROW]));
    const { user } = renderDialog();

    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Reset progress" }));

    // The destructive confirm names the participant and the preservation.
    const dialog = await screen.findByRole("dialog", {
      name: "Reset this participant's progress?",
    });
    expect(within(dialog).getByText(/preserved as Part History/i)).toBeInTheDocument();

    // The reset POST resets completion and climbs the prior-attempt count.
    fetchSpy.respondWith(
      new Response(JSON.stringify(RESET_FULL_VIEW), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Reset progress" }));

    // Optimistic in-place patch: completion flips to in-progress and the
    // prior-attempt count appears — no roster refetch.
    await waitFor(() => expect(screen.getByText("In progress")).toBeInTheDocument());
    expect(screen.getByText(/3 prior attempts preserved/i)).toBeInTheDocument();
  });

  it("403 renders a neutral no-retry surface; a non-facilitator can't act", async () => {
    fetchSpy.respondWith(problem(403));
    renderDialog();

    await waitFor(() =>
      expect(screen.getByText("Participants aren't available")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("5xx keeps a danger Callout with a retry that refetches the roster", async () => {
    fetchSpy.respondWith(problem(503));
    const { user } = renderDialog();

    await waitFor(() => expect(screen.getByText("Couldn't load participants")).toBeInTheDocument());

    fetchSpy.respondWith(roster([ROW]));
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeInTheDocument());
  });
});
