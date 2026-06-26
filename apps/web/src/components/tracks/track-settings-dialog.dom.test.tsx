import type { ContributionPolicyEnvelope, LearningTrack } from "@hearth/domain";
import { screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackCaps } from "../../hooks/use-tracks.ts";
import { renderWithProviders } from "../../test/render.tsx";

/**
 * The track-settings branches an SSR-string test can't drive: re-hydration of
 * {name, description, status, policy} when the dialog opens, the COMBINED dirty
 * gate (form-dirty OR status-dirty OR policy-dirty enables Save), the
 * sequential metadata→status→policy save where a metadata failure binds the
 * name field and skips the later mutations while keeping the dialog open with
 * the staged selections, the status/policy radios firing their own mutation on
 * Save, and the danger-zone archive confirm success-close vs failure-toast.
 *
 * Each mutation hook is a controllable stub whose pending/error state the test
 * flips; `toast` is stubbed so the archive-failure path is observable.
 */

type MutationStub = {
  mutateAsync: ReturnType<typeof vi.fn>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
};

const updateMetadata: MutationStub = {
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};
const updateStatus: MutationStub = {
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};
const updatePolicy: MutationStub = {
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};
const updatePeerProgress: MutationStub = {
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};
const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("../../hooks/use-tracks.ts", () => ({
  useUpdateTrackMetadata: () => updateMetadata,
  useUpdateTrackStatus: () => updateStatus,
  useUpdateTrackContributionPolicy: () => updatePolicy,
  useSetPeerProgressVisibility: () => updatePeerProgress,
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

import { TrackSettingsDialog } from "./track-settings-dialog.tsx";

const FULL_CAPS: TrackCaps = {
  canEditMetadata: true,
  canEditStructure: true,
  canEditContributionPolicy: true,
  canPause: true,
  canResume: true,
  canArchive: true,
};

function makeTrack(over: Partial<LearningTrack> = {}): LearningTrack {
  return {
    id: "t_1" as LearningTrack["id"],
    groupId: "g_1" as LearningTrack["groupId"],
    name: "Beginner Spanish",
    description: "A patient pace.",
    status: "active",
    peerProgressVisibility: "shared",
    pausedAt: null,
    archivedAt: null,
    archivedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

const POLICY: ContributionPolicyEnvelope = { v: 1, data: { mode: "direct" } };

function resetStub(s: MutationStub) {
  s.mutateAsync.mockReset();
  s.isPending = false;
  s.isError = false;
  s.error = null;
}

function renderDialog(over: Partial<Parameters<typeof TrackSettingsDialog>[0]> = {}) {
  return renderWithProviders(
    <TrackSettingsDialog
      open
      onClose={() => {}}
      track={makeTrack()}
      groupId="g_1"
      contributionPolicy={POLICY}
      caps={FULL_CAPS}
      {...over}
    />,
  );
}

beforeEach(() => {
  resetStub(updateMetadata);
  resetStub(updateStatus);
  resetStub(updatePolicy);
  resetStub(updatePeerProgress);
  toastSuccess.mockReset();
  toastError.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function nameInput(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Name" });
}
function saveButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Save changes" });
}

describe("TrackSettingsDialog re-hydration", () => {
  it("seeds name/description from the track and reflects the current status + policy", () => {
    renderDialog();
    expect(nameInput()).toHaveValue("Beginner Spanish");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("A patient pace.");
    expect(screen.getByRole("radio", { name: /Active/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Direct/ })).toBeChecked();
  });

  it("re-seeds when the track prop changes under an open dialog (concurrent edit)", async () => {
    function Host() {
      const [track, setTrack] = useState(makeTrack());
      return (
        <div>
          <button
            type="button"
            onClick={() => setTrack(makeTrack({ name: "Renamed elsewhere", status: "paused" }))}
          >
            Apply remote edit
          </button>
          <TrackSettingsDialog
            open
            onClose={() => {}}
            track={track}
            groupId="g_1"
            contributionPolicy={POLICY}
            caps={FULL_CAPS}
          />
        </div>
      );
    }
    const { user } = renderWithProviders(<Host />);
    expect(nameInput()).toHaveValue("Beginner Spanish");

    await user.click(screen.getByRole("button", { name: "Apply remote edit" }));
    await waitFor(() => expect(nameInput()).toHaveValue("Renamed elsewhere"));
    expect(screen.getByRole("radio", { name: /Paused/ })).toBeChecked();
  });
});

describe("TrackSettingsDialog combined dirty gate", () => {
  it("disables Save on a pristine dialog", () => {
    renderDialog();
    expect(saveButton()).toBeDisabled();
  });

  it("enables Save when only the status radio changes (no metadata edit)", async () => {
    const { user } = renderDialog();
    expect(saveButton()).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /Paused/ }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
  });

  it("enables Save when only the contribution policy changes", async () => {
    const { user } = renderDialog();
    await user.click(screen.getByRole("radio", { name: /Required review/ }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
  });
});

describe("TrackSettingsDialog sequential save", () => {
  it("fires only the status mutation when only status changed", async () => {
    updateStatus.mutateAsync.mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { user } = renderDialog({ onClose });

    await user.click(screen.getByRole("radio", { name: /Paused/ }));
    await user.click(saveButton());

    await waitFor(() => expect(updateStatus.mutateAsync).toHaveBeenCalledWith("pause"));
    expect(updateMetadata.mutateAsync).not.toHaveBeenCalled();
    expect(updatePolicy.mutateAsync).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("fires the policy mutation with the versioned envelope when only policy changed", async () => {
    updatePolicy.mutateAsync.mockResolvedValue(undefined);
    const { user } = renderDialog();

    await user.click(screen.getByRole("radio", { name: /Required review/ }));
    await user.click(saveButton());

    await waitFor(() =>
      expect(updatePolicy.mutateAsync).toHaveBeenCalledWith({
        v: 1,
        data: { mode: "required_review" },
      }),
    );
  });

  it("binds a metadata failure to the name field and skips the staged status/policy mutations", async () => {
    // Metadata write rejects; its isError latches (React Query), which routes
    // the error onto the name field. The later status + policy mutations must
    // NOT fire, and the dialog stays open with the staged selections.
    updateMetadata.mutateAsync.mockRejectedValueOnce(new Error("Name already in use."));
    updateMetadata.isError = true;
    updateMetadata.error = new Error("Name already in use.");
    const onClose = vi.fn();
    const { user } = renderDialog({ onClose });

    await user.type(nameInput(), " edited");
    await user.click(screen.getByRole("radio", { name: /Paused/ }));
    await user.click(screen.getByRole("radio", { name: /Required review/ }));
    await user.click(saveButton());

    expect(await screen.findByText("Name already in use.")).toBeInTheDocument();
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    expect(updateStatus.mutateAsync).not.toHaveBeenCalled();
    expect(updatePolicy.mutateAsync).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Staged selections survive for a retry.
    expect(screen.getByRole("radio", { name: /Paused/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Required review/ })).toBeChecked();
  });
});

describe("TrackSettingsDialog peer progress visibility", () => {
  // The contribution-policy "none" mode also reads "Facilitators only", so the
  // peer-progress radios are addressed by their distinct hint text.
  const facilitatorsOnlyProgress = () =>
    screen.getByRole("radio", { name: /Only facilitators see participants/ });

  it("seeds the current setting and fires the mutation on a flip", async () => {
    updatePeerProgress.mutateAsync.mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { user } = renderDialog({ onClose });

    expect(screen.getByRole("radio", { name: /Shared/ })).toBeChecked();
    expect(saveButton()).toBeDisabled();

    await user.click(facilitatorsOnlyProgress());
    await waitFor(() => expect(saveButton()).toBeEnabled());

    await user.click(saveButton());
    await waitFor(() =>
      expect(updatePeerProgress.mutateAsync).toHaveBeenCalledWith("facilitator_only"),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe("TrackSettingsDialog archived read-only", () => {
  it("disables metadata inputs and hides the status/policy/danger sections", () => {
    renderDialog({
      track: makeTrack({ status: "archived" }),
      caps: { ...FULL_CAPS, canEditMetadata: false },
    });
    expect(nameInput()).toBeDisabled();
    expect(screen.queryByRole("radio", { name: /Paused/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Direct/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive track" })).not.toBeInTheDocument();
  });
});

describe("TrackSettingsDialog danger-zone archive", () => {
  it("closes both modals on a successful archive confirm", async () => {
    updateStatus.mutateAsync.mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { user } = renderDialog({ onClose });

    await user.click(screen.getByRole("button", { name: "Archive track" }));
    const confirm = await screen.findByRole("dialog", {
      name: "Archive this Learning Track?",
    });
    // Type-to-confirm phrase gates the terminal action.
    await user.type(within(confirm).getByRole("textbox"), "archive");
    await user.click(within(confirm).getByRole("button", { name: "Archive track" }));

    await waitFor(() => expect(updateStatus.mutateAsync).toHaveBeenCalledWith("archive"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("toasts and keeps the confirm open when the archive fails", async () => {
    updateStatus.mutateAsync.mockRejectedValueOnce(new Error("Archive failed."));
    const onClose = vi.fn();
    const { user } = renderDialog({ onClose });

    await user.click(screen.getByRole("button", { name: "Archive track" }));
    const confirm = await screen.findByRole("dialog", {
      name: "Archive this Learning Track?",
    });
    await user.type(within(confirm).getByRole("textbox"), "archive");
    await user.click(within(confirm).getByRole("button", { name: "Archive track" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Archive failed."));
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Archive this Learning Track?" }),
    ).toBeInTheDocument();
  });
});
