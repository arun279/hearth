import { Modal } from "@hearth/ui";
import { screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { ConfirmActionDialog } from "./confirm-action-dialog.tsx";

/**
 * The session-scoped error latch and focus restoration an SSR-string test
 * can't drive. The dialog only closes on success, so a failed confirm must
 * latch a durable in-dialog Callout — but a latched error from a PRIOR open
 * (close -> reopen, or a sibling dialog sharing the mutation) must stay hidden
 * until the user confirms again in the new session. Both transitions need a
 * real DOM mount + user events.
 */

const ERROR_TEXT = "The delete request failed.";

afterEach(() => {
  vi.useRealTimers();
});

/**
 * A controlled host: a trigger that opens the dialog, with the latched
 * `errorMessage` always passed (mirroring a React Query mutation whose
 * `isError` stays set across open/close). `onConfirm` is wired by the test.
 */
function Host({ onConfirm }: { readonly onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <ConfirmActionDialog
        open={open}
        title="Delete this activity?"
        confirmLabel="Delete activity"
        tone="destructive"
        errorMessage={ERROR_TEXT}
        onConfirm={onConfirm}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

describe("ConfirmActionDialog session-scoped error latch", () => {
  it("suppresses a latched error on a fresh open, surfaces it after confirm, and suppresses it again on reopen", async () => {
    const onConfirm = vi.fn();
    const { user } = renderWithProviders(<Host onConfirm={onConfirm} />);

    // Fresh open with a latched errorMessage: no Callout yet.
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText(ERROR_TEXT)).not.toBeInTheDocument();

    // Confirm fails (the mutation stays errored, dialog stays open) -> Callout.
    await user.click(screen.getByRole("button", { name: "Delete activity" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(ERROR_TEXT)).toBeInTheDocument();

    // Close, then reopen: the stale latched error is suppressed again.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText(ERROR_TEXT)).not.toBeInTheDocument();
  });
});

describe("ConfirmActionDialog focus restoration", () => {
  it("returns focus to the trigger after the dialog closes", async () => {
    const { user } = renderWithProviders(<Host onConfirm={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });

    await user.click(trigger);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // The dialog-keyboard hook restores focus to the opener after the flush.
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("returns focus to the in-panel trigger when the confirm closes over a still-open parent dialog", async () => {
    function NestedHost() {
      const [confirmOpen, setConfirmOpen] = useState(false);
      return (
        <>
          <Modal open onClose={() => {}} title="Settings">
            <button type="button" onClick={() => setConfirmOpen(true)}>
              Delete this
            </button>
          </Modal>
          <ConfirmActionDialog
            open={confirmOpen}
            title="Delete this activity?"
            confirmLabel="Delete activity"
            tone="destructive"
            onConfirm={() => {}}
            onClose={() => setConfirmOpen(false)}
          />
        </>
      );
    }

    const { user } = renderWithProviders(<NestedHost />);
    const innerTrigger = screen.getByRole("button", { name: "Delete this" });
    await user.click(innerTrigger);

    // Two dialogs are now stacked; close the topmost (the confirm) via Cancel.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Delete activity" })).not.toBeInTheDocument(),
    );

    // Focus must land back on the in-parent trigger — not leak to <body>
    // behind the parent dialog that's still open (WCAG 2.1.2).
    await waitFor(() => expect(innerTrigger).toHaveFocus());
  });
});
