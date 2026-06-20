import type { ApprovedEmail } from "@hearth/domain";
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";

/**
 * The ApprovedEmailsTab branches an SSR-string test can't drive. The novel,
 * e2e-hostile surface is the bulk-paste iterative-submission loop: each line
 * validates client-side, POSTs independently, and reports a per-row ok/err
 * result. The textarea clears whenever at least one line succeeds (partial
 * success keeps the result rows for inspection) but is retained verbatim when
 * every line fails so the operator can retry, and the toast distinguishes
 * all / partial / none ("Added X of Y"). The single-row RHF form (Zod
 * validation, server-error→email binding, reset on success) and the
 * remove-confirm error latch reuse known shapes.
 */

type QueryStub = { data: { entries: readonly ApprovedEmail[] } | undefined; isLoading: boolean };
type MutationStub = {
  mutateAsync: ReturnType<typeof vi.fn>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
};

const emailsQuery: QueryStub = { data: undefined, isLoading: false };
const add: MutationStub = { mutateAsync: vi.fn(), isPending: false, isError: false, error: null };
const remove: MutationStub = {
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("../../hooks/use-instance-admin.ts", () => ({
  useApprovedEmails: () => emailsQuery,
  useAddApprovedEmail: () => add,
  useRemoveApprovedEmail: () => remove,
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

import { ApprovedEmailsTab } from "./approved-emails-tab.tsx";

function approved(email: string, note: string | null = null): ApprovedEmail {
  return {
    email,
    addedBy: "u_admin" as ApprovedEmail["addedBy"],
    addedAt: new Date("2026-01-01T00:00:00Z"),
    note,
  };
}

function resetMutation(m: MutationStub) {
  m.mutateAsync.mockReset();
  m.isPending = false;
  m.isError = false;
  m.error = null;
}

/**
 * Per-row results render as "<email> — <message>" with the email in a nested
 * `<span>`, so the text spans multiple nodes. Match the whole `<li>` by its
 * combined textContent.
 */
function bulkRow(re: RegExp): HTMLElement {
  return screen.getByText((_content, el) => el?.tagName === "LI" && re.test(el.textContent ?? ""));
}

async function findBulkRow(re: RegExp): Promise<HTMLElement> {
  return screen.findByText((_content, el) => el?.tagName === "LI" && re.test(el.textContent ?? ""));
}

/** Expand the <details> wrapping the bulk-paste form and return its textarea. */
async function openBulk(): Promise<HTMLTextAreaElement> {
  const summary = screen.getByText("Paste a list (one email per line)");
  // happy-dom does not toggle <details> on summary click; set it directly.
  const details = summary.closest("details") as HTMLDetailsElement;
  details.open = true;
  return screen.getByRole("textbox", {
    name: "Paste a list (one email per line)",
  }) as HTMLTextAreaElement;
}

beforeEach(() => {
  emailsQuery.data = { entries: [] };
  emailsQuery.isLoading = false;
  resetMutation(add);
  resetMutation(remove);
  toastSuccess.mockReset();
  toastError.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ApprovedEmailsTab single-row add", () => {
  it("rejects an invalid email via the Zod resolver without POSTing", async () => {
    const { user } = renderWithProviders(<ApprovedEmailsTab />);
    const email = screen.getByRole("textbox", { name: "Email" });

    await user.type(email, "no-domain");
    await user.click(screen.getByRole("button", { name: "Add email" }));

    expect(
      await screen.findByText("Enter a valid email like name@example.com."),
    ).toBeInTheDocument();
    expect(add.mutateAsync).not.toHaveBeenCalled();
    expect(email).toHaveAttribute("aria-invalid", "true");
  });

  it("POSTs the lowercased email with an optional note, then resets the fields", async () => {
    add.mutateAsync.mockResolvedValue(approved("maya@example.com"));
    const { user } = renderWithProviders(<ApprovedEmailsTab />);

    await user.type(screen.getByRole("textbox", { name: "Email" }), "Maya@Example.com");
    await user.type(screen.getByRole("textbox", { name: "Note (optional)" }), "  Book club  ");
    await user.click(screen.getByRole("button", { name: "Add email" }));

    await waitFor(() => expect(add.mutateAsync).toHaveBeenCalledTimes(1));
    expect(add.mutateAsync).toHaveBeenCalledWith({ email: "maya@example.com", note: "Book club" });
    expect(toastSuccess).toHaveBeenCalledWith("Email approved.");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue(""));
    expect(screen.getByRole("textbox", { name: "Note (optional)" })).toHaveValue("");
  });

  it("binds a thrown server error onto the email field", async () => {
    add.mutateAsync.mockRejectedValue(new Error("Already approved."));
    const { user } = renderWithProviders(<ApprovedEmailsTab />);

    await user.type(screen.getByRole("textbox", { name: "Email" }), "dupe@example.com");
    await user.click(screen.getByRole("button", { name: "Add email" }));

    expect(await screen.findByText("Already approved.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveAttribute("aria-invalid", "true");
  });
});

describe("ApprovedEmailsTab bulk paste", () => {
  it("skips an invalid-format line with a per-row message and never POSTs it", async () => {
    const { user } = renderWithProviders(<ApprovedEmailsTab />);
    const textarea = await openBulk();

    await user.type(textarea, "not-an-email");
    await user.click(screen.getByRole("button", { name: "Add all" }));

    // Per-row results render as "<email> — <message>" in one <li>.
    expect(await findBulkRow(/not-an-email — Invalid format\./)).toBeInTheDocument();
    expect(add.mutateAsync).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't add any of 1 emails. See per-row reasons below.",
    );
  });

  it("maps a duplicate (server-rejected) line to a per-row error", async () => {
    add.mutateAsync.mockRejectedValueOnce(new Error("Already approved."));
    const { user } = renderWithProviders(<ApprovedEmailsTab />);
    const textarea = await openBulk();

    await user.type(textarea, "dupe@example.com");
    await user.click(screen.getByRole("button", { name: "Add all" }));

    expect(await findBulkRow(/dupe@example\.com — Already approved\./)).toBeInTheDocument();
    expect(add.mutateAsync).toHaveBeenCalledWith({ email: "dupe@example.com" });
    // All-fail: the textarea keeps the failed line for retry.
    await waitFor(() => expect(textarea).toHaveValue("dupe@example.com"));
  });

  it("mixed batch: clears the textarea, renders per-row ok/err results, partial toast fires", async () => {
    add.mutateAsync
      .mockResolvedValueOnce(approved("ok1@example.com"))
      .mockRejectedValueOnce(new Error("Already approved."))
      .mockResolvedValueOnce(approved("ok2@example.com"));
    const { user } = renderWithProviders(<ApprovedEmailsTab />);
    const textarea = await openBulk();

    await user.type(textarea, "ok1@example.com{Enter}dupe@example.com{Enter}ok2@example.com");
    await user.click(screen.getByRole("button", { name: "Add all" }));

    // Per-row results: two successes, one failure.
    expect(await findBulkRow(/dupe@example\.com — Already approved\./)).toBeInTheDocument();
    expect(bulkRow(/ok1@example\.com — added/)).toBeInTheDocument();
    expect(bulkRow(/ok2@example\.com — added/)).toBeInTheDocument();
    expect(add.mutateAsync).toHaveBeenCalledTimes(3);

    // successes > 0 clears the textarea entirely (per the component contract).
    await waitFor(() => expect(textarea).toHaveValue(""));
    expect(toastSuccess).toHaveBeenCalledWith("Added 2 of 3.");
  });

  it("all-success batch: clears the textarea and toasts the full count", async () => {
    add.mutateAsync
      .mockResolvedValueOnce(approved("a@example.com"))
      .mockResolvedValueOnce(approved("b@example.com"));
    const { user } = renderWithProviders(<ApprovedEmailsTab />);
    const textarea = await openBulk();

    await user.type(textarea, "a@example.com{Enter}b@example.com");
    await user.click(screen.getByRole("button", { name: "Add all" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Added 2 emails."));
    expect(textarea).toHaveValue("");
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe("ApprovedEmailsTab remove confirm", () => {
  it("latches the failure in the confirm Callout, then closes on a successful retry", async () => {
    emailsQuery.data = { entries: [approved("gone@example.com")] };
    remove.mutateAsync.mockRejectedValueOnce(new Error("Remove failed on the server."));
    remove.isError = true;
    remove.error = new Error("Remove failed on the server.");
    const { user, rerender } = renderWithProviders(<ApprovedEmailsTab />);

    await user.click(screen.getByRole("button", { name: "Remove gone@example.com" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove approved email" });

    await user.click(within(dialog).getByRole("button", { name: "Remove email" }));
    expect(await within(dialog).findByText("Remove failed on the server.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Remove approved email" })).toBeInTheDocument();

    remove.mutateAsync.mockResolvedValueOnce(undefined);
    remove.isError = false;
    remove.error = null;
    rerender(<ApprovedEmailsTab />);

    const dialog2 = screen.getByRole("dialog", { name: "Remove approved email" });
    await user.click(within(dialog2).getByRole("button", { name: "Remove email" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Remove approved email" }),
      ).not.toBeInTheDocument(),
    );
    expect(remove.mutateAsync).toHaveBeenLastCalledWith("gone@example.com");
  });

  it("disables the row remove button while a remove is pending", () => {
    emailsQuery.data = { entries: [approved("gone@example.com")] };
    remove.isPending = true;
    renderWithProviders(<ApprovedEmailsTab />);
    expect(screen.getByRole("button", { name: "Remove gone@example.com" })).toBeDisabled();
  });
});
