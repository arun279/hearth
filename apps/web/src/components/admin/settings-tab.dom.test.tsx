import type { InstanceSettings } from "@hearth/domain";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";

/**
 * The SettingsTab branches an SSR-string test can't drive: the query
 * loading / error / data fork, the form hydrating from `query.data` on
 * arrival, the dirty-gate on Save, a thrown server error binding onto the
 * name field with the aria-invalid / aria-describedby contract, and the
 * isSubmitting state flipping the button label + disabling the input.
 *
 * The empty-submit Zod assertion is the resolver-version tripwire
 * (docs/tripwires.md § @hookform/resolvers × Zod) — until now only the
 * dialog-keyboard e2e exercised an RHF + zodResolver empty-submit.
 */

type QueryStub = { data: InstanceSettings | undefined; isLoading: boolean; isError: boolean };
type MutationStub = { mutateAsync: ReturnType<typeof vi.fn> };

const settingsQuery: QueryStub = { data: undefined, isLoading: false, isError: false };
const rename: MutationStub = { mutateAsync: vi.fn() };
const toastSuccess = vi.fn();

vi.mock("../../hooks/use-instance-admin.ts", () => ({
  useInstanceSettings: () => settingsQuery,
  useRenameInstance: () => rename,
}));
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a) },
}));

import { SettingsTab } from "./settings-tab.tsx";

const SETTINGS: InstanceSettings = {
  name: "Hearth",
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  updatedBy: null,
};

function nameInput(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Instance name" });
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /^(Save changes|Saving…)$/ });
}

beforeEach(() => {
  settingsQuery.data = SETTINGS;
  settingsQuery.isLoading = false;
  settingsQuery.isError = false;
  rename.mutateAsync.mockReset();
  toastSuccess.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SettingsTab query branches", () => {
  it("renders the loading skeleton (no form) while the query is in flight", () => {
    settingsQuery.data = undefined;
    settingsQuery.isLoading = true;
    renderWithProviders(<SettingsTab />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the error branch when the query fails", () => {
    settingsQuery.data = undefined;
    settingsQuery.isError = true;
    renderWithProviders(<SettingsTab />);
    expect(
      screen.getByText("Couldn't load instance settings. Reload to retry."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("hydrates the name input from query.data on arrival", () => {
    renderWithProviders(<SettingsTab />);
    expect(nameInput()).toHaveValue("Hearth");
  });
});

describe("SettingsTab dirty gate", () => {
  it("disables Save on a pristine (hydrated) form and enables it once the name changes", async () => {
    const { user } = renderWithProviders(<SettingsTab />);
    expect(saveButton()).toBeDisabled();

    await user.type(nameInput(), " Club");
    await waitFor(() => expect(saveButton()).toBeEnabled());
  });

  it("re-disables Save when the edited value is reverted to the hydrated original", async () => {
    const { user } = renderWithProviders(<SettingsTab />);
    await user.type(nameInput(), "X");
    await waitFor(() => expect(saveButton()).toBeEnabled());

    await user.type(nameInput(), "{Backspace}");
    await waitFor(() => expect(saveButton()).toBeDisabled());
  });
});

describe("SettingsTab submit", () => {
  it("surfaces the Zod required-name error on empty submit (resolver-version tripwire)", async () => {
    const { user } = renderWithProviders(<SettingsTab />);
    // Clear the hydrated value, then drive the submit through the form — the
    // dirty-gate enables Save once the field diverges from "Hearth".
    await user.clear(nameInput());
    await user.click(saveButton());

    expect(await screen.findByText("Name is required.")).toBeInTheDocument();
    expect(rename.mutateAsync).not.toHaveBeenCalled();
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    expect(nameInput()).toHaveAttribute(
      "aria-describedby",
      screen.getByRole("alert").getAttribute("id"),
    );
  });

  it("calls the rename mutation with the trimmed name and toasts on success", async () => {
    rename.mutateAsync.mockResolvedValue(SETTINGS);
    const { user } = renderWithProviders(<SettingsTab />);

    await user.clear(nameInput());
    await user.type(nameInput(), "  Tuesday Night Learners  ");
    await user.click(saveButton());

    await waitFor(() => expect(rename.mutateAsync).toHaveBeenCalledTimes(1));
    // The Zod schema trims before the mutation sees the value.
    expect(rename.mutateAsync).toHaveBeenCalledWith("Tuesday Night Learners");
    expect(toastSuccess).toHaveBeenCalledWith("Instance renamed.");
  });

  it("binds a thrown server error onto the name field with the a11y contract and no toast", async () => {
    rename.mutateAsync.mockRejectedValue(new Error("That name is taken."));
    const { user } = renderWithProviders(<SettingsTab />);

    await user.clear(nameInput());
    await user.type(nameInput(), "Dupe");
    await user.click(saveButton());

    expect(await screen.findByText("That name is taken.")).toBeInTheDocument();
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    expect(nameInput()).toHaveAttribute(
      "aria-describedby",
      screen.getByRole("alert").getAttribute("id"),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("flips the button to 'Saving…' and disables the input while the mutation is in flight", async () => {
    let resolveRename: (v: InstanceSettings) => void = () => {};
    rename.mutateAsync.mockReturnValue(
      new Promise<InstanceSettings>((resolve) => {
        resolveRename = resolve;
      }),
    );
    const { user } = renderWithProviders(<SettingsTab />);

    await user.clear(nameInput());
    await user.type(nameInput(), "New name");
    await user.click(saveButton());

    expect(await screen.findByRole("button", { name: "Saving…" })).toBeInTheDocument();
    expect(nameInput()).toBeDisabled();

    resolveRename(SETTINGS);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument(),
    );
    expect(nameInput()).toBeEnabled();
  });
});
