import type { GroupInvitation, StudyGroup } from "@hearth/domain";
import { screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";

/**
 * The two-phase invite flow an SSR-string test can't drive: the onChange
 * resolver gating the submit button until the email is well-formed, the
 * form→result toggle on a successful create, the copy-to-clipboard
 * success/failure fork, the emailApproved warning Callout, and the reset back
 * to the form phase on reopen.
 */

const createAsync = vi.fn();
const copyToClipboard = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("../../hooks/use-group-invitations.ts", () => ({
  useCreateGroupInvitation: () => ({ mutateAsync: createAsync, isPending: false }),
}));
vi.mock("../../lib/clipboard.ts", () => ({
  copyTextToClipboard: (...a: unknown[]) => copyToClipboard(...a),
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

import { InviteDialog } from "./invite-dialog.tsx";

const GROUP: StudyGroup = {
  id: "g_1" as StudyGroup["id"],
  name: "Tuesday Night Learners",
  description: null,
  admissionPolicy: "invite_only",
  status: "active",
  archivedAt: null,
  archivedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function invitation(): GroupInvitation {
  return {
    id: "inv_1" as GroupInvitation["id"],
    groupId: GROUP.id,
    trackId: null,
    token: "tok_abc",
    email: "newbie@example.com",
    createdBy: "u_1" as GroupInvitation["createdBy"],
    createdAt: new Date(),
    expiresAt: new Date(),
    consumedAt: null,
    consumedBy: null,
    revokedAt: null,
    revokedBy: null,
  };
}

beforeEach(() => {
  createAsync.mockReset();
  copyToClipboard.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function emailInput(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Invitee email" });
}

describe("InviteDialog submit gate", () => {
  it("disables submit until a well-formed email is entered (onChange resolver)", async () => {
    const { user } = renderWithProviders(<InviteDialog open onClose={() => {}} group={GROUP} />);
    const submit = screen.getByRole("button", { name: "Create invitation" });
    expect(submit).toBeDisabled();

    await user.type(emailInput(), "not-an-email");
    expect(submit).toBeDisabled();

    await user.type(emailInput(), "@example.com");
    await waitFor(() => expect(submit).toBeEnabled());
  });
});

describe("InviteDialog result phase", () => {
  it("toggles to the result phase with the readonly link on a successful create", async () => {
    createAsync.mockResolvedValue({ invitation: invitation(), emailApproved: true });
    const { user } = renderWithProviders(<InviteDialog open onClose={() => {}} group={GROUP} />);

    await user.type(emailInput(), "newbie@example.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));

    const link = await screen.findByRole("textbox", { name: "Invitation link" });
    expect(link).toHaveAttribute("readonly");
    expect(link).toHaveValue(`${window.location.origin}/invite/tok_abc`);
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });

  it("shows the private-instance warning Callout only when emailApproved is false", async () => {
    createAsync.mockResolvedValue({ invitation: invitation(), emailApproved: false });
    const { user } = renderWithProviders(<InviteDialog open onClose={() => {}} group={GROUP} />);

    await user.type(emailInput(), "newbie@example.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));

    expect(await screen.findByText("Approved Email needed")).toBeInTheDocument();
  });

  it("omits the warning Callout when emailApproved is true", async () => {
    createAsync.mockResolvedValue({ invitation: invitation(), emailApproved: true });
    const { user } = renderWithProviders(<InviteDialog open onClose={() => {}} group={GROUP} />);

    await user.type(emailInput(), "newbie@example.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));

    await screen.findByRole("textbox", { name: "Invitation link" });
    expect(screen.queryByText("Approved Email needed")).not.toBeInTheDocument();
  });
});

describe("InviteDialog copy fork", () => {
  it("toasts success when the clipboard write succeeds", async () => {
    createAsync.mockResolvedValue({ invitation: invitation(), emailApproved: true });
    copyToClipboard.mockResolvedValue(true);
    const { user } = renderWithProviders(<InviteDialog open onClose={() => {}} group={GROUP} />);

    await user.type(emailInput(), "newbie@example.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    await user.click(await screen.findByRole("button", { name: "Copy link" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Invitation link copied."));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("toasts the manual-copy fallback when the clipboard write fails", async () => {
    createAsync.mockResolvedValue({ invitation: invitation(), emailApproved: true });
    copyToClipboard.mockResolvedValue(false);
    const { user } = renderWithProviders(<InviteDialog open onClose={() => {}} group={GROUP} />);

    await user.type(emailInput(), "newbie@example.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    await user.click(await screen.findByRole("button", { name: "Copy link" }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalledWith("Invitation link copied.");
  });
});

describe("InviteDialog reset on reopen", () => {
  it("returns to the form phase when the dialog reopens after a result", async () => {
    createAsync.mockResolvedValue({ invitation: invitation(), emailApproved: true });
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Reopen
          </button>
          <InviteDialog open={open} onClose={() => setOpen(false)} group={GROUP} />
        </div>
      );
    }
    const { user } = renderWithProviders(<Host />);

    await user.type(emailInput(), "newbie@example.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    await screen.findByRole("textbox", { name: "Invitation link" });

    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Reopen" }));
    await screen.findByRole("dialog");
    // Back on the form phase: the email field is present and empty, no link.
    expect(emailInput()).toHaveValue("");
    expect(screen.queryByRole("textbox", { name: "Invitation link" })).not.toBeInTheDocument();
  });
});
