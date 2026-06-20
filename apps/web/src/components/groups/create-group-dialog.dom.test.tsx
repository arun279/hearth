import { screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { CreateGroupDialog } from "./create-group-dialog.tsx";

/**
 * The RHF + zodResolver wiring an SSR-string test can't drive:
 *   - the empty-submit Zod error surfacing on the name field is the
 *     resolver-version tripwire (docs/tripwires.md § @hookform/resolvers × Zod)
 *     that, until now, only the dialog-keyboard e2e exercised;
 *   - the submit-disabled gate tracking `name.trim()` after the field is touched;
 *   - a thrown server error mapping onto the name field with aria-invalid +
 *     aria-describedby;
 *   - the trimmed-name / conditional-description payload passed to onCreate;
 *   - the form resetting to blank when the dialog reopens.
 */

afterEach(() => {
  vi.clearAllMocks();
});

/** Host that toggles `open` so the close→reopen reset branch is observable. */
function Host({
  onCreate,
}: {
  readonly onCreate: (input: { name: string; description?: string }) => Promise<void>;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
      <CreateGroupDialog open={open} onClose={() => setOpen(false)} onCreate={onCreate} />
    </div>
  );
}

function nameInput(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Name" });
}

describe("CreateGroupDialog validation", () => {
  it("surfaces the Zod required-name error on empty submit (resolver-version tripwire)", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<CreateGroupDialog open onClose={() => {}} onCreate={onCreate} />);

    // The submit button is disabled while name is empty, so route the submit
    // through the form to prove the resolver itself rejects an empty value
    // (the gate this tripwire watches: a stuck resolver lets a blank name
    // through and never surfaces the error).
    const form = document.getElementById("create-group-form") as HTMLFormElement;
    form.requestSubmit();

    expect(await screen.findByText("Give your group a name.")).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
    // The error wires through to the input's a11y contract.
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    expect(nameInput()).toHaveAttribute(
      "aria-describedby",
      screen.getByRole("alert").getAttribute("id"),
    );
  });

  it("keeps submit disabled for whitespace-only name even after the field is touched", async () => {
    const { user } = renderWithProviders(
      <CreateGroupDialog open onClose={() => {}} onCreate={vi.fn()} />,
    );
    const submit = screen.getByRole("button", { name: "Create Study Group" });
    expect(submit).toBeDisabled();

    await user.type(nameInput(), "   ");
    expect(submit).toBeDisabled();

    await user.type(nameInput(), "Real name");
    await waitFor(() => expect(submit).toBeEnabled());
  });
});

describe("CreateGroupDialog submit", () => {
  it("calls onCreate with a trimmed name and omits an empty description", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { user } = renderWithProviders(
      <CreateGroupDialog open onClose={() => {}} onCreate={onCreate} />,
    );

    await user.type(nameInput(), "  Tuesday Night Learners  ");
    await user.click(screen.getByRole("button", { name: "Create Study Group" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith({ name: "Tuesday Night Learners" });
  });

  it("passes a trimmed description only when one is entered", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { user } = renderWithProviders(
      <CreateGroupDialog open onClose={() => {}} onCreate={onCreate} />,
    );

    await user.type(nameInput(), "Book club");
    await user.type(screen.getByRole("textbox", { name: "Description" }), "  Patient pace.  ");
    await user.click(screen.getByRole("button", { name: "Create Study Group" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith({ name: "Book club", description: "Patient pace." });
  });

  it("maps a thrown server error onto the name field with the a11y contract", async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error("Name already taken."));
    const { user } = renderWithProviders(
      <CreateGroupDialog open onClose={() => {}} onCreate={onCreate} />,
    );

    await user.type(nameInput(), "Dupe");
    await user.click(screen.getByRole("button", { name: "Create Study Group" }));

    expect(await screen.findByText("Name already taken.")).toBeInTheDocument();
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    expect(nameInput()).toHaveAttribute(
      "aria-describedby",
      screen.getByRole("alert").getAttribute("id"),
    );
  });
});

describe("CreateGroupDialog reset on reopen", () => {
  it("clears typed input when the dialog closes and reopens", async () => {
    const { user } = renderWithProviders(<Host onCreate={vi.fn()} />);

    await user.type(nameInput(), "Half-typed");
    expect(nameInput()).toHaveValue("Half-typed");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Reopen" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(nameInput()).toHaveValue("");
  });
});
