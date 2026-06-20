import type { GroupInvitation, GroupInvitationStatus, StudyGroup } from "@hearth/domain";
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupInvitationView } from "../../hooks/use-group-invitations.ts";
import { renderWithProviders } from "../../test/render.tsx";

/**
 * The invitations-panel branches an SSR-string test can't drive: the query
 * loading / empty / data fork, the status→action-visibility mapping (Copy /
 * Revoke appear only on live invitations), the clipboard copy success vs
 * fallback toast, and the revoke-confirm error latch + retry.
 */

type QueryStub = { data: unknown; isLoading: boolean };
type MutationStub = {
  mutateAsync: ReturnType<typeof vi.fn>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
};

const invitationsQuery: QueryStub = { data: undefined, isLoading: false };
const revoke: MutationStub = {
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};
const copyToClipboard = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("../../hooks/use-group-invitations.ts", () => ({
  useGroupInvitations: () => invitationsQuery,
  useRevokeGroupInvitation: () => revoke,
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

import { InvitationsPanel } from "./invitations-panel.tsx";

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

function view(
  id: string,
  email: string | null,
  status: GroupInvitationStatus,
): GroupInvitationView {
  const invitation: GroupInvitation = {
    id: id as GroupInvitation["id"],
    groupId: GROUP.id,
    trackId: null,
    token: `tok_${id}`,
    email,
    createdBy: "u_1" as GroupInvitation["createdBy"],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    expiresAt: new Date("2026-01-15T00:00:00Z"),
    consumedAt: null,
    consumedBy: null,
    revokedAt: null,
    revokedBy: null,
  };
  return { invitation, status };
}

function resetMutation(m: MutationStub) {
  m.mutateAsync.mockReset();
  m.isPending = false;
  m.isError = false;
  m.error = null;
}

beforeEach(() => {
  invitationsQuery.data = undefined;
  invitationsQuery.isLoading = false;
  resetMutation(revoke);
  copyToClipboard.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("InvitationsPanel list branches", () => {
  it("renders the loading branch", () => {
    invitationsQuery.isLoading = true;
    renderWithProviders(<InvitationsPanel group={GROUP} enabled />);
    expect(screen.getByText("Loading invitations…")).toBeInTheDocument();
  });

  it("renders the empty branch", () => {
    invitationsQuery.data = [];
    renderWithProviders(<InvitationsPanel group={GROUP} enabled />);
    expect(screen.getByText("No invitations outstanding.")).toBeInTheDocument();
  });

  it("renders the data branch with each invitee", () => {
    invitationsQuery.data = [view("a", "live@example.com", "pending")];
    renderWithProviders(<InvitationsPanel group={GROUP} enabled />);
    expect(screen.getByText("live@example.com")).toBeInTheDocument();
  });
});

describe("InvitationsPanel status→action mapping", () => {
  it("shows Copy + Revoke only for live invitations", () => {
    invitationsQuery.data = [
      view("a", "live@example.com", "pending"),
      view("b", "waiting@example.com", "pending_approval"),
      view("c", "gone@example.com", "consumed"),
      view("d", "old@example.com", "expired"),
    ];
    renderWithProviders(<InvitationsPanel group={GROUP} enabled />);
    const list = screen.getByRole("list", { name: "Outstanding invitations" });

    // Two live rows → two Copy + two Revoke; the consumed/expired rows have none.
    expect(within(list).getAllByRole("button", { name: /^Copy invite link/ })).toHaveLength(2);
    expect(within(list).getAllByRole("button", { name: "Revoke" })).toHaveLength(2);
  });
});

describe("InvitationsPanel copy fork", () => {
  it("toasts success when the clipboard write succeeds", async () => {
    copyToClipboard.mockResolvedValue(true);
    invitationsQuery.data = [view("a", "live@example.com", "pending")];
    const { user } = renderWithProviders(<InvitationsPanel group={GROUP} enabled />);

    await user.click(screen.getByRole("button", { name: /^Copy invite link/ }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Invitation link copied."));
    expect(toastError).not.toHaveBeenCalled();
    expect(copyToClipboard).toHaveBeenCalledWith(`${window.location.origin}/invite/tok_a`);
  });

  it("toasts the manual-copy fallback when the clipboard write fails", async () => {
    copyToClipboard.mockResolvedValue(false);
    invitationsQuery.data = [view("a", "live@example.com", "pending")];
    const { user } = renderWithProviders(<InvitationsPanel group={GROUP} enabled />);

    await user.click(screen.getByRole("button", { name: /^Copy invite link/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("InvitationsPanel revoke confirm error latch", () => {
  it("latches the failure in the confirm Callout, then closes on a successful retry", async () => {
    revoke.mutateAsync.mockRejectedValueOnce(new Error("Couldn't revoke."));
    revoke.isError = true;
    revoke.error = new Error("Couldn't revoke.");
    invitationsQuery.data = [view("a", "live@example.com", "pending")];
    const { user, rerender } = renderWithProviders(<InvitationsPanel group={GROUP} enabled />);

    await user.click(screen.getByRole("button", { name: "Revoke" }));
    const confirm = await screen.findByRole("dialog", { name: "Revoke this invitation?" });
    await user.click(within(confirm).getByRole("button", { name: "Revoke" }));
    expect(await within(confirm).findByText("Couldn't revoke.")).toBeInTheDocument();

    revoke.mutateAsync.mockResolvedValueOnce(undefined);
    revoke.isError = false;
    revoke.error = null;
    rerender(<InvitationsPanel group={GROUP} enabled />);

    const confirm2 = screen.getByRole("dialog", { name: "Revoke this invitation?" });
    await user.click(within(confirm2).getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Revoke this invitation?" }),
      ).not.toBeInTheDocument(),
    );
    expect(revoke.mutateAsync).toHaveBeenCalledWith("a");
  });
});
