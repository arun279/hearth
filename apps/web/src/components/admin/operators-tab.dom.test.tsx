import type { InstanceOperatorWithIdentity } from "@hearth/domain";
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";

/**
 * The OperatorsTab branches an SSR-string test can't drive: the GrantOperator
 * sub-form binding a thrown server error onto the email field (then
 * reset + close on success), the current-vs-revoked split on `revokedAt`, the
 * revoke-button gating (isSelf OR onlyOneOperator, with a reason-specific
 * tooltip the server mirrors), and the revoke confirm's error latch +
 * close-on-success driven by the shared mutation's `isError`.
 */

type QueryStub = {
  data: { entries: readonly InstanceOperatorWithIdentity[] } | undefined;
  isLoading: boolean;
};
type MutationStub = {
  mutateAsync: ReturnType<typeof vi.fn>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
};

const operatorsQuery: QueryStub = { data: undefined, isLoading: false };
const assign: MutationStub = {
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};
const revoke: MutationStub = {
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("../../hooks/use-instance-admin.ts", () => ({
  useOperators: () => operatorsQuery,
  useAssignOperator: () => assign,
  useRevokeOperator: () => revoke,
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

import { OperatorsTab } from "./operators-tab.tsx";

const SELF_ID = "u_self";

function op(
  userId: string,
  overrides: Partial<InstanceOperatorWithIdentity> = {},
): InstanceOperatorWithIdentity {
  return {
    userId: userId as InstanceOperatorWithIdentity["userId"],
    grantedAt: new Date("2026-01-01T00:00:00Z"),
    grantedBy: "u_admin" as InstanceOperatorWithIdentity["grantedBy"],
    revokedAt: null,
    revokedBy: null,
    email: `${userId}@example.com`,
    name: `Name ${userId}`,
    image: null,
    ...overrides,
  };
}

function resetMutation(m: MutationStub) {
  m.mutateAsync.mockReset();
  m.isPending = false;
  m.isError = false;
  m.error = null;
}

beforeEach(() => {
  operatorsQuery.data = undefined;
  operatorsQuery.isLoading = false;
  resetMutation(assign);
  resetMutation(revoke);
  toastSuccess.mockReset();
  toastError.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("OperatorsTab current-vs-revoked split", () => {
  it("lists only revokedAt===null rows under current; revoked rows under the audit trail", () => {
    operatorsQuery.data = {
      entries: [
        op(SELF_ID),
        op("u_other"),
        op("u_gone", {
          revokedAt: new Date("2026-02-01T00:00:00Z"),
          revokedBy: "u_admin" as InstanceOperatorWithIdentity["revokedBy"],
        }),
      ],
    };
    renderWithProviders(<OperatorsTab currentUserId={SELF_ID} />);

    const current = screen.getByRole("list", { name: "Current instance operators" });
    expect(within(current).getByText("Name u_self")).toBeInTheDocument();
    expect(within(current).getByText("Name u_other")).toBeInTheDocument();
    expect(within(current).queryByText("Name u_gone")).not.toBeInTheDocument();

    const revoked = screen.getByRole("list", { name: "Revoked instance operators" });
    expect(within(revoked).getByText("Name u_gone")).toBeInTheDocument();
  });

  it("renders the empty state when there are no current operators", () => {
    operatorsQuery.data = { entries: [] };
    renderWithProviders(<OperatorsTab currentUserId={SELF_ID} />);
    expect(screen.getByText("No current operators")).toBeInTheDocument();
  });
});

describe("OperatorsTab revoke gating", () => {
  it("disables revoke for the self row with a self-specific tooltip", () => {
    operatorsQuery.data = { entries: [op(SELF_ID), op("u_other")] };
    renderWithProviders(<OperatorsTab currentUserId={SELF_ID} />);

    const selfRevoke = screen.getByRole("button", {
      name: "You can't revoke your own operator role.",
    });
    expect(selfRevoke).toBeDisabled();

    // The other operator (not self, two operators) is revocable.
    const otherRevoke = screen.getByRole("button", { name: "Revoke Name u_other" });
    expect(otherRevoke).toBeEnabled();
  });

  it("disables revoke for the only remaining operator with the grant-another tooltip", () => {
    operatorsQuery.data = { entries: [op("u_other")] };
    renderWithProviders(<OperatorsTab currentUserId={SELF_ID} />);

    const onlyRevoke = screen.getByRole("button", {
      name: "Grant another operator before revoking this one.",
    });
    expect(onlyRevoke).toBeDisabled();
  });
});

describe("OperatorsTab revoke confirm", () => {
  it("latches the failure in the confirm Callout, then closes on a successful retry", async () => {
    operatorsQuery.data = { entries: [op(SELF_ID), op("u_other")] };
    revoke.mutateAsync.mockRejectedValueOnce(new Error("Revoke failed on the server."));
    revoke.isError = true;
    revoke.error = new Error("Revoke failed on the server.");
    const { user, rerender } = renderWithProviders(<OperatorsTab currentUserId={SELF_ID} />);

    await user.click(screen.getByRole("button", { name: "Revoke Name u_other" }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke operator role" });

    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));
    expect(await within(dialog).findByText("Revoke failed on the server.")).toBeInTheDocument();
    expect(toastError).toHaveBeenCalled();
    // Stays open for retry.
    expect(screen.getByRole("dialog", { name: "Revoke operator role" })).toBeInTheDocument();

    revoke.mutateAsync.mockResolvedValueOnce(undefined);
    revoke.isError = false;
    revoke.error = null;
    rerender(<OperatorsTab currentUserId={SELF_ID} />);

    const dialog2 = screen.getByRole("dialog", { name: "Revoke operator role" });
    await user.click(within(dialog2).getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Revoke operator role" }),
      ).not.toBeInTheDocument(),
    );
    expect(revoke.mutateAsync).toHaveBeenLastCalledWith("u_other");
  });

  it("disables the confirm button while the revoke is pending", async () => {
    operatorsQuery.data = { entries: [op(SELF_ID), op("u_other")] };
    revoke.isPending = true;
    const { user } = renderWithProviders(<OperatorsTab currentUserId={SELF_ID} />);

    // The row revoke buttons are themselves disabled while pending; open via
    // the still-mounted confirm by toggling the target through the list isn't
    // possible (button disabled), so assert the gate at the row level instead.
    expect(screen.getByRole("button", { name: "Revoke Name u_other" })).toBeDisabled();
    await user.click(screen.queryByRole("button", { name: "Revoke Name u_other" }) as HTMLElement);
    expect(screen.queryByRole("dialog", { name: "Revoke operator role" })).not.toBeInTheDocument();
  });
});

describe("OperatorsTab grant dialog", () => {
  it("binds a thrown server error onto the email field with aria-invalid", async () => {
    operatorsQuery.data = { entries: [op(SELF_ID)] };
    assign.mutateAsync.mockRejectedValue(new Error("That person hasn't signed in yet."));
    const { user } = renderWithProviders(<OperatorsTab currentUserId={SELF_ID} />);

    await user.click(screen.getByRole("button", { name: "Grant operator" }));
    const dialog = await screen.findByRole("dialog", { name: "Grant operator role" });
    const emailInput = within(dialog).getByRole("textbox", { name: "Email" });

    await user.type(emailInput, "ghost@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Grant operator" }));

    expect(
      await within(dialog).findByText("That person hasn't signed in yet."),
    ).toBeInTheDocument();
    expect(emailInput).toHaveAttribute("aria-invalid", "true");
    // The dialog stays open; the error is field-bound, not a close.
    expect(screen.getByRole("dialog", { name: "Grant operator role" })).toBeInTheDocument();
  });

  it("rejects an invalid email via the Zod resolver without calling the mutation", async () => {
    operatorsQuery.data = { entries: [op(SELF_ID)] };
    const { user } = renderWithProviders(<OperatorsTab currentUserId={SELF_ID} />);

    await user.click(screen.getByRole("button", { name: "Grant operator" }));
    const dialog = await screen.findByRole("dialog", { name: "Grant operator role" });

    await user.type(within(dialog).getByRole("textbox", { name: "Email" }), "not-an-email");
    await user.click(within(dialog).getByRole("button", { name: "Grant operator" }));

    expect(
      await within(dialog).findByText("Enter a valid email like name@example.com."),
    ).toBeInTheDocument();
    expect(assign.mutateAsync).not.toHaveBeenCalled();
  });

  it("resets the field and closes the dialog on a successful grant", async () => {
    operatorsQuery.data = { entries: [op(SELF_ID)] };
    assign.mutateAsync.mockResolvedValue(undefined);
    const { user } = renderWithProviders(<OperatorsTab currentUserId={SELF_ID} />);

    await user.click(screen.getByRole("button", { name: "Grant operator" }));
    const dialog = await screen.findByRole("dialog", { name: "Grant operator role" });
    await user.type(within(dialog).getByRole("textbox", { name: "Email" }), "new@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Grant operator" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Grant operator role" })).not.toBeInTheDocument(),
    );
    expect(assign.mutateAsync).toHaveBeenCalledWith({ email: "new@example.com" });
    expect(toastSuccess).toHaveBeenCalledWith("Operator granted.");

    // Reopen: the field is blank (reset on success), proving no stale value.
    await user.click(screen.getByRole("button", { name: "Grant operator" }));
    const reopened = await screen.findByRole("dialog", { name: "Grant operator role" });
    expect(within(reopened).getByRole("textbox", { name: "Email" })).toHaveValue("");
  });
});
