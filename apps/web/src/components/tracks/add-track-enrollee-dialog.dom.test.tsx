import type { GroupMembership } from "@hearth/domain";
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupMemberRow } from "../../hooks/use-group-members.ts";
import { renderWithProviders } from "../../test/render.tsx";

/**
 * The member-picker branches an SSR-string test can't drive: the group-members
 * query loading / error+refetch / empty fork, the candidate filter+sort
 * (current enrollees excluded, previously-left kept and tagged, sorted by
 * displayName), and the per-row async state — `pendingUserId` isolates a single
 * row so only that row shows "Adding…" while the others stay clickable, and
 * both success and failure clear it.
 */

type QueryStub = {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: ReturnType<typeof vi.fn>;
};
type MutationStub = {
  mutateAsync: ReturnType<typeof vi.fn>;
  isPending: boolean;
};

const membersQuery: QueryStub = {
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
};
const enroll: MutationStub = { mutateAsync: vi.fn(), isPending: false };

vi.mock("../../hooks/use-group-members.ts", () => ({
  useGroupMembers: () => membersQuery,
}));
vi.mock("../../hooks/use-tracks.ts", () => ({
  useEnrollInTrack: () => enroll,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AddTrackEnrolleeDialog } from "./add-track-enrollee-dialog.tsx";

function membership(userId: string): GroupMembership {
  return {
    groupId: "g_1" as GroupMembership["groupId"],
    userId: userId as GroupMembership["userId"],
    role: "participant",
    joinedAt: new Date(),
    removedAt: null,
    removedBy: null,
    attributionOnLeave: null,
    displayNameSnapshot: null,
    profile: { nickname: null, avatarUrl: null, bio: null, updatedAt: null },
  };
}

function row(userId: string, displayName: string): GroupMemberRow {
  return {
    membership: membership(userId),
    displayName,
    capabilities: { canRemove: false, canPromote: false, canDemote: false },
  };
}

function renderDialog(over: Partial<Parameters<typeof AddTrackEnrolleeDialog>[0]> = {}) {
  return renderWithProviders(
    <AddTrackEnrolleeDialog
      open
      onClose={() => {}}
      groupId="g_1"
      trackId="t_1"
      trackName="Beginner Spanish"
      avatarOrigin="https://cdn.test"
      enrolledUserIds={[]}
      leftUserIds={[]}
      {...over}
    />,
  );
}

beforeEach(() => {
  membersQuery.data = undefined;
  membersQuery.isLoading = false;
  membersQuery.isError = false;
  membersQuery.error = null;
  membersQuery.refetch.mockReset();
  enroll.mutateAsync.mockReset();
  enroll.isPending = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AddTrackEnrolleeDialog query branches", () => {
  it("renders the loading skeletons branch", () => {
    membersQuery.isLoading = true;
    renderDialog();
    expect(screen.queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();
    expect(screen.queryByText("Everyone's on this track")).not.toBeInTheDocument();
  });

  it("renders the error branch with a working refetch affordance", async () => {
    membersQuery.isError = true;
    membersQuery.error = new Error("network down");
    const { user } = renderDialog();

    expect(screen.getByText("Couldn't load group members")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(membersQuery.refetch).toHaveBeenCalledTimes(1);
  });

  it("renders the empty state when no members remain after filtering enrollees", () => {
    membersQuery.data = {
      group: {},
      adminCount: 1,
      entries: [row("u_2", "Sam")],
    };
    renderDialog({ enrolledUserIds: ["u_2"] });
    expect(screen.getByText("Everyone's on this track")).toBeInTheDocument();
  });
});

describe("AddTrackEnrolleeDialog candidate filter and sort", () => {
  it("excludes current enrollees, keeps previously-left tagged, and sorts by displayName", () => {
    membersQuery.data = {
      group: {},
      adminCount: 1,
      entries: [
        row("u_z", "Zoe"),
        row("u_a", "Aaron"),
        row("u_left", "Lee"),
        row("u_enrolled", "Mara"),
      ],
    };
    renderDialog({ enrolledUserIds: ["u_enrolled"], leftUserIds: ["u_left"] });

    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    // Mara (enrolled) is filtered out; the remaining three are alphabetical.
    expect(items).toHaveLength(3);
    expect(items.map((li) => within(li).getByText(/Aaron|Lee|Zoe/).textContent)).toEqual([
      "Aaron",
      "Lee",
      "Zoe",
    ]);
    expect(screen.queryByText("Mara")).not.toBeInTheDocument();

    // The previously-left member is tagged and offers "Re-add".
    const leeRow = items.find((li) => within(li).queryByText("Lee")) as HTMLElement;
    expect(within(leeRow).getByText("previously enrolled")).toBeInTheDocument();
    expect(within(leeRow).getByRole("button", { name: "Add Lee" })).toHaveTextContent("Re-add");
    // A never-enrolled member offers plain "Add".
    const aaronRow = items.find((li) => within(li).queryByText("Aaron")) as HTMLElement;
    expect(within(aaronRow).getByRole("button", { name: "Add Aaron" })).toHaveTextContent("Add");
  });
});

describe("AddTrackEnrolleeDialog per-row pending isolation", () => {
  it("shows Adding… only on the clicked row while others stay clickable, then clears on success", async () => {
    // Hold the mutation open so the pending window is observable.
    let resolveEnroll: (() => void) | undefined;
    enroll.mutateAsync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveEnroll = resolve;
        }),
    );
    membersQuery.data = {
      group: {},
      adminCount: 1,
      entries: [row("u_a", "Aaron"), row("u_b", "Bea")],
    };
    const { user } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Add Aaron" }));

    // Only Aaron's row flips to Adding…; Bea's row is disabled (a sibling add
    // is in flight) but its label is unchanged.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add Aaron" })).toHaveTextContent("Adding…"),
    );
    const beaButton = screen.getByRole("button", { name: "Add Bea" });
    expect(beaButton).toHaveTextContent("Add");
    expect(beaButton).toBeDisabled();
    expect(enroll.mutateAsync).toHaveBeenCalledWith({ targetUserId: "u_a" });

    resolveEnroll?.();
    // Success clears pendingUserId → all rows clickable again.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add Aaron" })).toHaveTextContent("Add"),
    );
    expect(screen.getByRole("button", { name: "Add Bea" })).toBeEnabled();
  });

  it("clears the pending row and re-enables it when the add fails", async () => {
    enroll.mutateAsync.mockRejectedValueOnce(new Error("enroll failed"));
    membersQuery.data = {
      group: {},
      adminCount: 1,
      entries: [row("u_a", "Aaron")],
    };
    const { user } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Add Aaron" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Add Aaron" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Add Aaron" })).toHaveTextContent("Add");
  });
});
