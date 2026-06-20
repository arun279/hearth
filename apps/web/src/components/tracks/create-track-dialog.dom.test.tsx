import { screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { CreateTrackDialog } from "./create-track-dialog.tsx";

/**
 * The RHF + zodResolver wiring an SSR-string test can't drive. This is the
 * mirror-pair of CreateGroupDialog (jscpd-ignored in source), so the branches
 * are the same shape on a distinct file:
 *   - empty-submit surfacing the Zod required-name error on the name field is
 *     the resolver-version tripwire (docs/tripwires.md § @hookform/resolvers ×
 *     Zod) that otherwise only the dialog-keyboard e2e exercises;
 *   - the submit-disabled gate tracking `name.trim()`;
 *   - a thrown onCreate error mapping onto the name field with aria-invalid +
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
      <CreateTrackDialog open={open} onClose={() => setOpen(false)} onCreate={onCreate} />
    </div>
  );
}

function nameInput(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Name" });
}

describe("CreateTrackDialog validation", () => {
  it("surfaces the Zod required-name error on empty submit (resolver-version tripwire)", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<CreateTrackDialog open onClose={() => {}} onCreate={onCreate} />);

    // The submit button is disabled while name is empty, so route the submit
    // through the form to prove the resolver itself rejects an empty value —
    // a stuck resolver would let the blank through and never surface the error.
    const form = document.getElementById("create-track-form") as HTMLFormElement;
    form.requestSubmit();

    expect(await screen.findByText("Give your Learning Track a name.")).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    expect(nameInput()).toHaveAttribute(
      "aria-describedby",
      screen.getByRole("alert").getAttribute("id"),
    );
  });

  it("keeps submit disabled for a whitespace-only name even after the field is touched", async () => {
    const { user } = renderWithProviders(
      <CreateTrackDialog open onClose={() => {}} onCreate={vi.fn()} />,
    );
    const submit = screen.getByRole("button", { name: "Create Learning Track" });
    expect(submit).toBeDisabled();

    await user.type(nameInput(), "   ");
    expect(submit).toBeDisabled();

    await user.type(nameInput(), "Beginner Spanish");
    await waitFor(() => expect(submit).toBeEnabled());
  });
});

describe("CreateTrackDialog submit", () => {
  it("calls onCreate with a trimmed name and omits an empty description", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { user } = renderWithProviders(
      <CreateTrackDialog open onClose={() => {}} onCreate={onCreate} />,
    );

    await user.type(nameInput(), "  Beginner Spanish  ");
    await user.click(screen.getByRole("button", { name: "Create Learning Track" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith({ name: "Beginner Spanish" });
  });

  it("passes a trimmed description only when one is entered", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { user } = renderWithProviders(
      <CreateTrackDialog open onClose={() => {}} onCreate={onCreate} />,
    );

    await user.type(nameInput(), "Italian");
    await user.type(screen.getByRole("textbox", { name: "Description" }), "  Week by week.  ");
    await user.click(screen.getByRole("button", { name: "Create Learning Track" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith({ name: "Italian", description: "Week by week." });
  });

  it("maps a thrown onCreate error onto the name field with the a11y contract", async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error("A track with that name exists."));
    const { user } = renderWithProviders(
      <CreateTrackDialog open onClose={() => {}} onCreate={onCreate} />,
    );

    await user.type(nameInput(), "Dupe");
    await user.click(screen.getByRole("button", { name: "Create Learning Track" }));

    expect(await screen.findByText("A track with that name exists.")).toBeInTheDocument();
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    expect(nameInput()).toHaveAttribute(
      "aria-describedby",
      screen.getByRole("alert").getAttribute("id"),
    );
  });
});

describe("CreateTrackDialog reset on reopen", () => {
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
