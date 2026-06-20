import type { GroupMembership, StudyGroup } from "@hearth/domain";
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupMemberCapabilities, GroupMemberRow } from "../../hooks/use-group-members.ts";
import { renderWithProviders } from "../../test/render.tsx";

/**
 * The member-management branches an SSR-string test can't drive: the query
 * loading / empty / data fork, per-row action visibility gated on each
 * capability flag, the discriminated-union confirm state picking the right
 * dialog tone/copy per kind, the role-change error latch + retry, and the
 * close-blocked-while-pending guard.
 *
 * The members query and the two role/remove mutations are controllable stubs;
 * `useMeContext` is stubbed to a stable operator identity.
 */

type QueryStub = {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
};
type MutationStub = {
  mutateAsync: ReturnType<typeof vi.fn>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
};

const membersQuery: QueryStub = { data: undefined, isLoading: false, isError: false };
const setRole: MutationStub = {
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};
const remove: MutationStub = {
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};

vi.mock("../../hooks/use-group-members.ts", () => ({
  useGroupMembers: () => membersQuery,
  useSetGroupAdmin: () => setRole,
  useRemoveGroupMember: () => remove,
}));
vi.mock("../../hooks/use-me-context.ts", () => ({
  useMeContext: () => ({
    data: { data: { user: { id: "u_me" }, instance: { r2PublicOrigin: "https://cdn.test" } } },
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GroupMembersDialog } from "./group-members-dialog.tsx";

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

function membership(userId: string, role: "admin" | "participant"): GroupMembership {
  return {
    groupId: GROUP.id,
    userId: userId as GroupMembership["userId"],
    role,
    joinedAt: new Date(),
    removedAt: null,
    removedBy: null,
    attributionOnLeave: null,
    displayNameSnapshot: null,
    profile: { nickname: null, avatarUrl: null, bio: null, updatedAt: null },
  };
}

function row(
  userId: string,
  displayName: string,
  role: "admin" | "participant",
  caps: GroupMemberCapabilities,
): GroupMemberRow {
  return { membership: membership(userId, role), displayName, capabilities: caps };
}

const NO_CAPS: GroupMemberCapabilities = { canRemove: false, canPromote: false, canDemote: false };

function resetMutation(m: MutationStub) {
  m.mutateAsync.mockReset();
  m.isPending = false;
  m.isError = false;
  m.error = null;
}

beforeEach(() => {
  membersQuery.data = undefined;
  membersQuery.isLoading = false;
  membersQuery.isError = false;
  resetMutation(setRole);
  resetMutation(remove);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GroupMembersDialog list branches", () => {
  it("renders the loading branch", () => {
    membersQuery.isLoading = true;
    renderWithProviders(<GroupMembersDialog open onClose={() => {}} group={GROUP} />);
    expect(screen.getByText("Loading members…")).toBeInTheDocument();
  });

  it("renders the empty branch when the data list is empty", () => {
    membersQuery.data = { group: GROUP, entries: [], adminCount: 0 };
    renderWithProviders(<GroupMembersDialog open onClose={() => {}} group={GROUP} />);
    expect(screen.getByText("No active members.")).toBeInTheDocument();
  });

  it("renders the member roster from the data branch", () => {
    membersQuery.data = {
      group: GROUP,
      entries: [row("u_me", "Me", "admin", NO_CAPS), row("u_2", "Sam", "participant", NO_CAPS)],
      adminCount: 1,
    };
    renderWithProviders(<GroupMembersDialog open onClose={() => {}} group={GROUP} />);
    const list = screen.getByRole("list", { name: "Group members" });
    expect(within(list).getByText("Me")).toBeInTheDocument();
    expect(within(list).getByText("Sam")).toBeInTheDocument();
  });
});

describe("GroupMembersDialog per-row capability gating", () => {
  it("shows only the affordances each row's capabilities allow", () => {
    membersQuery.data = {
      group: GROUP,
      entries: [
        // Promotable participant: Make admin only.
        row("u_2", "Sam", "participant", { canRemove: false, canPromote: true, canDemote: false }),
        // Demotable admin: Remove admin only.
        row("u_3", "Lee", "admin", { canRemove: false, canPromote: false, canDemote: true }),
        // Removable participant: Remove only.
        row("u_4", "Kim", "participant", { canRemove: true, canPromote: false, canDemote: false }),
      ],
      adminCount: 2,
    };
    renderWithProviders(<GroupMembersDialog open onClose={() => {}} group={GROUP} />);

    expect(screen.getByRole("button", { name: "Make admin" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove admin" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });
});

describe("GroupMembersDialog confirm state machine", () => {
  it("opens the promote confirm with the right copy and forwards the admin role", async () => {
    setRole.mutateAsync.mockResolvedValue(undefined);
    membersQuery.data = {
      group: GROUP,
      entries: [
        row("u_2", "Sam", "participant", { canRemove: false, canPromote: true, canDemote: false }),
      ],
      adminCount: 1,
    };
    const { user } = renderWithProviders(
      <GroupMembersDialog open onClose={() => {}} group={GROUP} />,
    );

    await user.click(screen.getByRole("button", { name: "Make admin" }));
    const confirm = await screen.findByRole("dialog", { name: "Promote to Group Admin?" });
    expect(within(confirm).getByText(/Sam will gain authority/)).toBeInTheDocument();

    await user.click(within(confirm).getByRole("button", { name: "Make admin" }));
    await waitFor(() =>
      expect(setRole.mutateAsync).toHaveBeenCalledWith({ userId: "u_2", role: "admin" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Promote to Group Admin?" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("opens the remove confirm with the destructive copy and forwards the userId", async () => {
    remove.mutateAsync.mockResolvedValue(undefined);
    membersQuery.data = {
      group: GROUP,
      entries: [
        row("u_4", "Kim", "participant", { canRemove: true, canPromote: false, canDemote: false }),
      ],
      adminCount: 1,
    };
    const { user } = renderWithProviders(
      <GroupMembersDialog open onClose={() => {}} group={GROUP} />,
    );

    await user.click(screen.getByRole("button", { name: "Remove" }));
    const confirm = await screen.findByRole("dialog", { name: "Remove from group?" });
    expect(within(confirm).getByText(/Kim will lose access/)).toBeInTheDocument();

    await user.click(within(confirm).getByRole("button", { name: "Remove member" }));
    await waitFor(() => expect(remove.mutateAsync).toHaveBeenCalledWith("u_4"));
  });
});

describe("GroupMembersDialog role-change error latch", () => {
  it("latches the failure in the confirm Callout and resets state on a successful retry", async () => {
    setRole.mutateAsync.mockRejectedValueOnce(new Error("Role change failed."));
    setRole.isError = true;
    setRole.error = new Error("Role change failed.");
    membersQuery.data = {
      group: GROUP,
      entries: [
        row("u_2", "Sam", "participant", { canRemove: false, canPromote: true, canDemote: false }),
      ],
      adminCount: 1,
    };
    const { user, rerender } = renderWithProviders(
      <GroupMembersDialog open onClose={() => {}} group={GROUP} />,
    );

    await user.click(screen.getByRole("button", { name: "Make admin" }));
    const confirm = await screen.findByRole("dialog", { name: "Promote to Group Admin?" });
    await user.click(within(confirm).getByRole("button", { name: "Make admin" }));
    expect(await within(confirm).findByText("Role change failed.")).toBeInTheDocument();

    setRole.mutateAsync.mockResolvedValueOnce(undefined);
    setRole.isError = false;
    setRole.error = null;
    rerender(<GroupMembersDialog open onClose={() => {}} group={GROUP} />);

    const confirm2 = screen.getByRole("dialog", { name: "Promote to Group Admin?" });
    await user.click(within(confirm2).getByRole("button", { name: "Make admin" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Promote to Group Admin?" }),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("GroupMembersDialog close guard", () => {
  it("blocks Close while a remove mutation is pending", async () => {
    remove.isPending = true;
    membersQuery.data = {
      group: GROUP,
      entries: [row("u_2", "Sam", "participant", NO_CAPS)],
      adminCount: 1,
    };
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <GroupMembersDialog open onClose={onClose} group={GROUP} />,
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
