import type { PeerProgressVisibility } from "@hearth/domain";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installFetchSpy } from "../../test/fetch-spy.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { TrackProgressTab } from "./track-progress-tab.tsx";

/**
 * The progress roster's fetch-driven branches: the shared-vs-facilitator
 * shaping (a facilitator sees prior-attempt counts; a peer doesn't), the
 * facilitator_only peer note, the empty state, and the error split (403
 * neutral / 5xx danger+retry). Driven through the real query + `assertOk`
 * pipeline so `errorStatus` sees a genuine `ApiError`.
 */

const ME_BODY = { data: { user: { id: "u-self" } } };

function jsonRes(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function problemRes(status: number): Response {
  return new Response(JSON.stringify({ title: "x", status, detail: "x", code: "x" }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

function activity(id: string, title: string): unknown {
  return {
    id,
    trackId: "t1",
    title,
    description: null,
    partCount: 1,
    partKindSequence: ["reflect"],
    libraryRefCount: 0,
    prereqCount: 0,
    suggestedNextCount: 0,
    audienceKind: "everyone_enrolled",
    window: null,
    postClosePolicy: null,
    completionRuleKind: "all_parts_complete",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function progressRow(over: {
  readonly participantId: string;
  readonly participantDisplayName: string;
  readonly activityId?: string;
  readonly completionState?: "in_progress" | "completed";
  readonly completedAt?: string | null;
  readonly retryCount?: number | null;
}): unknown {
  return {
    recordId: `rec-${over.participantId}-${over.activityId ?? "a1"}`,
    activityId: over.activityId ?? "a1",
    participantId: over.participantId,
    participantDisplayName: over.participantDisplayName,
    completionState: over.completionState ?? "in_progress",
    completedAt: over.completedAt ?? null,
    retryCount: over.retryCount ?? null,
  };
}

const ACTIVITIES = [activity("a1", "Intro"), activity("a2", "Practice")];

let fetchSpy: ReturnType<typeof installFetchSpy>;
const responders: { progress: () => Response; activities: () => Response } = {
  progress: () => jsonRes({ entries: [] }),
  activities: () => jsonRes(ACTIVITIES),
};

beforeEach(() => {
  fetchSpy = installFetchSpy();
  responders.progress = () => jsonRes({ entries: [] });
  responders.activities = () => jsonRes(ACTIVITIES);
  fetchSpy.spy.mockImplementation((input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.href : String(input);
    if (url.includes("/progress")) return Promise.resolve(responders.progress());
    if (url.includes("/activities")) return Promise.resolve(responders.activities());
    if (url.includes("/me/context")) return Promise.resolve(jsonRes(ME_BODY));
    return Promise.resolve(jsonRes({}));
  });
});

afterEach(() => {
  fetchSpy.restore();
});

function renderTab(peer: PeerProgressVisibility = "shared") {
  return renderWithProviders(<TrackProgressTab trackId="t1" peerProgressVisibility={peer} />);
}

describe("TrackProgressTab roster", () => {
  it("shows every enrollee's row on a shared track, with the self row badged", async () => {
    responders.progress = () =>
      jsonRes({
        entries: [
          progressRow({
            participantId: "u-self",
            participantDisplayName: "Ada Lovelace",
            activityId: "a1",
            completionState: "completed",
          }),
          progressRow({
            participantId: "u2",
            participantDisplayName: "Grace Hopper",
            activityId: "a1",
            completionState: "in_progress",
          }),
        ],
      });
    renderTab("shared");

    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeInTheDocument());
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    // Coarse cell carries activity + state, never a response.
    expect(screen.getAllByLabelText("Intro: completed").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Practice: not started").length).toBeGreaterThan(0);
  });

  it("surfaces facilitator-only prior-attempt counts when retryCount is present", async () => {
    responders.progress = () =>
      jsonRes({
        entries: [
          progressRow({
            participantId: "u2",
            participantDisplayName: "Grace Hopper",
            activityId: "a1",
            completionState: "completed",
            retryCount: 2,
          }),
        ],
      });
    renderTab("shared");

    await waitFor(() => expect(screen.getByText(/2 prior attempts/)).toBeInTheDocument());
  });

  it("does not show prior-attempt counts to a peer viewer (retryCount null)", async () => {
    responders.progress = () =>
      jsonRes({
        entries: [
          progressRow({
            participantId: "u2",
            participantDisplayName: "Grace Hopper",
            activityId: "a1",
            completionState: "completed",
            retryCount: null,
          }),
        ],
      });
    renderTab("shared");

    await waitFor(() => expect(screen.getByText("Grace Hopper")).toBeInTheDocument());
    expect(screen.queryByText(/prior attempt/)).not.toBeInTheDocument();
  });

  it("a peer on a facilitator_only track sees the limited note", async () => {
    responders.progress = () =>
      jsonRes({
        entries: [
          progressRow({
            participantId: "u-self",
            participantDisplayName: "Ada Lovelace",
            activityId: "a1",
            retryCount: null,
          }),
        ],
      });
    renderTab("facilitator_only");

    await waitFor(() =>
      expect(screen.getByText(/Only facilitators see everyone's progress/)).toBeInTheDocument(),
    );
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("renders the empty state when no one has started", async () => {
    renderTab("shared");
    await waitFor(() => expect(screen.getByText("No progress yet")).toBeInTheDocument());
  });
});

describe("TrackProgressTab error split", () => {
  it("403 renders a neutral no-retry surface", async () => {
    responders.progress = () => problemRes(403);
    renderTab("shared");

    await waitFor(() => expect(screen.getByText("Progress isn't available")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("5xx keeps a danger Callout with a retry that refetches the roster", async () => {
    responders.progress = () => problemRes(503);
    const { user } = renderTab("shared");

    await waitFor(() => expect(screen.getByText("Couldn't load progress")).toBeInTheDocument());

    responders.progress = () =>
      jsonRes({
        entries: [
          progressRow({
            participantId: "u2",
            participantDisplayName: "Grace Hopper",
            activityId: "a1",
            completionState: "completed",
          }),
        ],
      });
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getByText("Grace Hopper")).toBeInTheDocument());
  });
});
