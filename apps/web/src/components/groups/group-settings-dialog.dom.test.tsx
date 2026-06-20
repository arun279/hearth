import type { StudyGroup } from "@hearth/domain";
import { screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupCaps } from "../../hooks/use-groups.ts";
import { renderWithProviders } from "../../test/render.tsx";

/**
 * The settings-dialog branches an SSR-string test can't drive: the Save gate
 * tracking `isDirty`, re-hydration when the `group` prop changes under an open
 * dialog (a concurrent edit landing), the archived read-only treatment, the
 * nested archive-confirm error latch → retry → success-close, and the
 * close-blocked-while-pending guard.
 *
 * Each mutation hook is a controllable stub whose pending/error state the test
 * flips between renders to exercise the gates.
 */

type MutationStub = {
  mutateAsync: ReturnType<typeof vi.fn>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
};

const update: MutationStub = {
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};
const archive: MutationStub = {
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};
const unarchive: MutationStub = {
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};

vi.mock("../../hooks/use-groups.ts", () => ({
  useUpdateGroupMetadata: () => update,
  useArchiveGroup: () => archive,
  useUnarchiveGroup: () => unarchive,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GroupSettingsDialog } from "./group-settings-dialog.tsx";

const FULL_CAPS: GroupCaps = {
  canArchive: true,
  canUnarchive: true,
  canUpdateMetadata: true,
  canManageMembership: true,
  canCreateInvitation: true,
};

function makeGroup(over: Partial<StudyGroup> = {}): StudyGroup {
  return {
    id: "g_1" as StudyGroup["id"],
    name: "Tuesday Night Learners",
    description: "A small group.",
    admissionPolicy: "invite_only",
    status: "active",
    archivedAt: null,
    archivedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function resetStub(s: MutationStub) {
  s.mutateAsync.mockReset();
  s.isPending = false;
  s.isError = false;
  s.error = null;
}

beforeEach(() => {
  resetStub(update);
  resetStub(archive);
  resetStub(unarchive);
});

afterEach(() => {
  vi.clearAllMocks();
});

function nameInput(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Name" });
}

describe("GroupSettingsDialog dirty gate", () => {
  it("disables Save on a pristine form and enables it once a field changes", async () => {
    const { user } = renderWithProviders(
      <GroupSettingsDialog open onClose={() => {}} group={makeGroup()} caps={FULL_CAPS} />,
    );
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    await user.type(nameInput(), " edited");
    await waitFor(() => expect(save).toBeEnabled());
  });

  it("hides the Save button entirely when canUpdateMetadata is false", () => {
    renderWithProviders(
      <GroupSettingsDialog
        open
        onClose={() => {}}
        group={makeGroup()}
        caps={{ ...FULL_CAPS, canUpdateMetadata: false }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });
});

describe("GroupSettingsDialog re-hydration", () => {
  it("re-seeds the form when the group prop changes under an open dialog", async () => {
    function Host() {
      const [group, setGroup] = useState(makeGroup());
      return (
        <div>
          <button type="button" onClick={() => setGroup(makeGroup({ name: "Renamed elsewhere" }))}>
            Apply remote rename
          </button>
          <GroupSettingsDialog open onClose={() => {}} group={group} caps={FULL_CAPS} />
        </div>
      );
    }
    const { user } = renderWithProviders(<Host />);
    expect(nameInput()).toHaveValue("Tuesday Night Learners");

    await user.click(screen.getByRole("button", { name: "Apply remote rename" }));
    await waitFor(() => expect(nameInput()).toHaveValue("Renamed elsewhere"));
  });
});

describe("GroupSettingsDialog archived state", () => {
  it("disables the metadata inputs and offers Unarchive when the group is archived", () => {
    // The server denies canUpdateMetadata on an archived group
    // (canUpdateGroupMetadata policy), which is what disables the inputs.
    renderWithProviders(
      <GroupSettingsDialog
        open
        onClose={() => {}}
        group={makeGroup({ status: "archived" })}
        caps={{ ...FULL_CAPS, canUpdateMetadata: false }}
      />,
    );
    expect(nameInput()).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Description" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Unarchive group" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive group" })).not.toBeInTheDocument();
  });
});

describe("GroupSettingsDialog archive confirm error latch", () => {
  it("latches the failed-archive error in the Callout, then clears on a successful retry", async () => {
    // First attempt rejects; the mutation's isError stays latched (mirroring
    // React Query) so the confirm dialog shows a durable danger Callout.
    archive.mutateAsync.mockRejectedValueOnce(new Error("Archive failed."));
    archive.isError = true;
    archive.error = new Error("Archive failed.");

    const onClose = vi.fn();
    const { user, rerender } = renderWithProviders(
      <GroupSettingsDialog open onClose={onClose} group={makeGroup()} caps={FULL_CAPS} />,
    );

    // Open the nested confirm via the danger-zone button.
    await user.click(screen.getByRole("button", { name: "Archive group" }));
    const confirm = await screen.findByRole("dialog", { name: "Archive this group?" });

    // Confirm → fail → in-dialog Callout (latched error surfaced after a confirm).
    await user.click(within(confirm).getByRole("button", { name: "Archive group" }));
    expect(await within(confirm).findByText("Archive failed.")).toBeInTheDocument();

    // Retry succeeds: clear the latched error and resolve the mutation.
    archive.mutateAsync.mockResolvedValueOnce(undefined);
    archive.isError = false;
    archive.error = null;
    rerender(<GroupSettingsDialog open onClose={onClose} group={makeGroup()} caps={FULL_CAPS} />);

    const confirm2 = screen.getByRole("dialog", { name: "Archive this group?" });
    await user.click(within(confirm2).getByRole("button", { name: "Archive group" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe("GroupSettingsDialog close guard", () => {
  it("blocks Close while an archive mutation is pending", async () => {
    // The `close` callback short-circuits on archive.isPending, so clicking
    // Close (or pressing Escape) is a no-op until the mutation settles —
    // guarding against tearing down the dialog mid-write.
    archive.isPending = true;
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <GroupSettingsDialog open onClose={onClose} group={makeGroup()} caps={FULL_CAPS} />,
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
