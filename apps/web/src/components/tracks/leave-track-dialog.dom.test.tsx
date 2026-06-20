import type { LearningTrack } from "@hearth/domain";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";

/**
 * LeaveTrackDialog is a thin wrapper over the already-seeded ConfirmActionDialog
 * (reversible action → plain Cancel/Confirm, no type-to-confirm). The novel
 * branches beyond the confirm-dialog seed are the leave-mutation integration:
 * the `isPending` gate on the buttons, and `isError` feeding the durable
 * `errorMessage` Callout so a failed leave stays readable for a retry. The
 * confirm dialog's own internals (phrase gate, focus restore) are NOT re-pinned
 * here — they live in confirm-action-dialog.dom.test.tsx.
 */

type MutationStub = {
  mutateAsync: ReturnType<typeof vi.fn>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
};

const leave: MutationStub = {
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};

vi.mock("../../hooks/use-tracks.ts", () => ({
  useLeaveTrack: () => leave,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { LeaveTrackDialog } from "./leave-track-dialog.tsx";

const TRACK: LearningTrack = {
  id: "t_1" as LearningTrack["id"],
  groupId: "g_1" as LearningTrack["groupId"],
  name: "Beginner Spanish",
  description: null,
  status: "active",
  pausedAt: null,
  archivedAt: null,
  archivedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  leave.mutateAsync.mockReset();
  leave.isPending = false;
  leave.isError = false;
  leave.error = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("LeaveTrackDialog confirm", () => {
  it("fires leave.mutateAsync and closes on success", async () => {
    leave.mutateAsync.mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <LeaveTrackDialog open onClose={onClose} groupId="g_1" track={TRACK} />,
    );

    await user.click(screen.getByRole("button", { name: "Leave track" }));
    await waitFor(() => expect(leave.mutateAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("disables the confirm + cancel buttons while the leave is pending", () => {
    leave.isPending = true;
    renderWithProviders(<LeaveTrackDialog open onClose={() => {}} groupId="g_1" track={TRACK} />);

    // While pending the confirm label is the dialog's own "Working…" state.
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});

describe("LeaveTrackDialog error surface", () => {
  it("renders the latched error in a durable Callout and leaves confirm live for retry", async () => {
    // First attempt rejects; React Query keeps `isError` latched, which the
    // dialog feeds to ConfirmActionDialog's `errorMessage`. The dialog only
    // closes on success, so onClose is never called.
    leave.mutateAsync.mockRejectedValueOnce(new Error("Couldn't reach the server."));
    leave.isError = true;
    leave.error = new Error("Couldn't reach the server.");
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <LeaveTrackDialog open onClose={onClose} groupId="g_1" track={TRACK} />,
    );

    const confirm = screen.getByRole("button", { name: "Leave track" });
    await user.click(confirm);

    expect(await screen.findByText("Couldn't reach the server.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // Not pending → the button is re-enabled for a retry.
    expect(confirm).toBeEnabled();
  });
});
