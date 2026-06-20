import type { StudyGroup } from "@hearth/domain";
import { screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";

/**
 * The leave gate an SSR-string test can't drive: the type-to-confirm match is
 * case-insensitive and whitespace-normalized (trim only, internal whitespace
 * significant), the attribution radio feeds the `leave.mutateAsync` payload,
 * and both reset when the dialog reopens.
 */

const leaveAsync = vi.fn();
const navigate = vi.fn();

vi.mock("../../hooks/use-group-members.ts", () => ({
  useLeaveGroup: () => ({ mutateAsync: leaveAsync, isPending: false }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { LeaveGroupDialog } from "./leave-group-dialog.tsx";

const GROUP: StudyGroup = {
  id: "g_1" as StudyGroup["id"],
  name: "Spanish Conversation Club",
  description: null,
  admissionPolicy: "invite_only",
  status: "active",
  archivedAt: null,
  archivedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  leaveAsync.mockReset().mockResolvedValue(undefined);
  navigate.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

function confirmInput(): HTMLInputElement {
  return screen.getByLabelText(/Type "Spanish Conversation Club" to confirm/);
}

function confirmButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Leave group" });
}

describe("LeaveGroupDialog type-to-confirm gate", () => {
  it("keeps confirm disabled until the typed name matches, normalizing case and outer whitespace", async () => {
    const { user } = renderWithProviders(
      <LeaveGroupDialog open onClose={() => {}} group={GROUP} />,
    );
    expect(confirmButton()).toBeDisabled();

    await user.type(confirmInput(), "spanish conversation");
    expect(confirmButton()).toBeDisabled();

    // Case-insensitive + outer-whitespace-tolerant exact match enables it.
    await user.clear(confirmInput());
    await user.type(confirmInput(), "  spanish conversation club  ");
    await waitFor(() => expect(confirmButton()).toBeEnabled());
  });

  it("treats internal whitespace as significant (no collapse)", async () => {
    const { user } = renderWithProviders(
      <LeaveGroupDialog open onClose={() => {}} group={GROUP} />,
    );
    // Double space between words must NOT match a single-spaced name.
    await user.type(confirmInput(), "Spanish  Conversation  Club");
    expect(confirmButton()).toBeDisabled();
  });
});

describe("LeaveGroupDialog attribution payload", () => {
  it("defaults to preserve_name and forwards the chosen attribution to mutateAsync", async () => {
    const { user } = renderWithProviders(
      <LeaveGroupDialog open onClose={() => {}} group={GROUP} />,
    );

    await user.type(confirmInput(), "Spanish Conversation Club");
    await user.click(confirmButton());
    await waitFor(() => expect(leaveAsync).toHaveBeenCalledWith({ attribution: "preserve_name" }));
  });

  it("forwards anonymize when that radio is selected", async () => {
    const { user } = renderWithProviders(
      <LeaveGroupDialog open onClose={() => {}} group={GROUP} />,
    );

    await user.click(screen.getByRole("radio", { name: /Anonymize/ }));
    await user.type(confirmInput(), "Spanish Conversation Club");
    await user.click(confirmButton());
    await waitFor(() => expect(leaveAsync).toHaveBeenCalledWith({ attribution: "anonymize" }));
  });
});

describe("LeaveGroupDialog reset on reopen", () => {
  it("clears the typed confirmation and resets attribution when reopened", async () => {
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Reopen
          </button>
          <LeaveGroupDialog open={open} onClose={() => setOpen(false)} group={GROUP} />
        </div>
      );
    }
    const { user } = renderWithProviders(<Host />);

    await user.click(screen.getByRole("radio", { name: /Anonymize/ }));
    await user.type(confirmInput(), "Spanish Conversation Club");
    await waitFor(() => expect(confirmButton()).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Reopen" }));
    await screen.findByRole("dialog");
    expect(confirmInput()).toHaveValue("");
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Preserve my name/ })).toBeChecked();
  });
});
