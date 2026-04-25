import { describe, expect, it, vi } from "vitest";
import { createGroupInvitation } from "../src/use-cases/create-group-invitation.ts";
import { listGroupInvitations } from "../src/use-cases/list-group-invitations.ts";
import { listGroupMembers } from "../src/use-cases/list-group-members.ts";
import { previewInvitation } from "../src/use-cases/preview-invitation.ts";
import { revokeGroupInvitation } from "../src/use-cases/revoke-group-invitation.ts";
import { setGroupAdmin } from "../src/use-cases/set-group-admin.ts";
import { updateGroupProfile } from "../src/use-cases/update-group-profile.ts";
import {
  ACTIVE_GROUP,
  ACTOR,
  ACTOR_ID,
  ARCHIVED_GROUP,
  GROUP_ID,
  INVITE_ID,
  invitation,
  makeGroups,
  makeIds,
  makePolicy,
  makeStorage,
  makeUsers,
  membership,
  TARGET,
  TARGET_ID,
  TEST_NOW,
} from "./_helpers.ts";

describe("listGroupMembers", () => {
  it("returns rows with capability bundles", async () => {
    const others = [
      membership({ role: "admin" }),
      membership({ userId: TARGET_ID, role: "participant" }),
    ];
    const result = await listGroupMembers(
      { actor: ACTOR_ID, groupId: GROUP_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          membership: vi.fn(async () => membership({ role: "admin" })),
          listMemberships: vi.fn(async () => others),
          countAdmins: vi.fn(async () => 2),
        }),
        policy: makePolicy(),
      },
    );
    expect(result.entries.length).toBe(2);
    const adminRow = result.entries.find((e) => e.membership.role === "admin");
    expect(adminRow?.capabilities.canDemote).toBe(true);
  });
});

describe("createGroupInvitation", () => {
  it("creates an invitation with a 14-day expiry", async () => {
    const create = vi.fn(async (input) => invitation({ token: input.token }));
    const result = await createGroupInvitation(
      {
        actor: ACTOR_ID,
        groupId: GROUP_ID,
        trackId: null,
        email: "Invitee@Example.COM",
        now: TEST_NOW,
      },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          membership: vi.fn(async () => membership({ role: "admin" })),
          createInvitation: create,
        }),
        policy: makePolicy({ isEmailApproved: vi.fn(async () => true) }),
        ids: makeIds(["new-id"]),
      },
    );
    expect(result.invitation.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.emailApproved).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "invitee@example.com",
        groupId: GROUP_ID,
      }),
    );
  });

  it("returns emailApproved=false when the email isn't on the allowlist", async () => {
    const result = await createGroupInvitation(
      {
        actor: ACTOR_ID,
        groupId: GROUP_ID,
        trackId: null,
        email: "pending@example.com",
        now: TEST_NOW,
      },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          membership: vi.fn(async () => membership({ role: "admin" })),
          createInvitation: vi.fn(async () => invitation({ email: "pending@example.com" })),
        }),
        policy: makePolicy({ isEmailApproved: vi.fn(async () => false) }),
        ids: makeIds(["new-id"]),
      },
    );
    expect(result.emailApproved).toBe(false);
  });

  it("rejects FORBIDDEN/not_group_admin for a participant actor", async () => {
    await expect(
      createGroupInvitation(
        { actor: ACTOR_ID, groupId: GROUP_ID, trackId: null, email: null, now: TEST_NOW },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            membership: vi.fn(async () => membership({ role: "participant" })),
          }),
          policy: makePolicy(),
          ids: makeIds(["x"]),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_group_admin" });
  });

  it("rejects an invalid email", async () => {
    await expect(
      createGroupInvitation(
        { actor: ACTOR_ID, groupId: GROUP_ID, trackId: null, email: "not-an-email", now: TEST_NOW },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => membership({ role: "admin" })) }),
          policy: makePolicy(),
          ids: makeIds(["x"]),
        },
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION", reason: "invalid_email" });
  });
});

describe("listGroupInvitations", () => {
  it("projects the status enum per row", async () => {
    const live = invitation();
    const expired = invitation({ id: "i_2" as typeof INVITE_ID, expiresAt: new Date(0) });
    const result = await listGroupInvitations(
      { actor: ACTOR_ID, groupId: GROUP_ID, now: TEST_NOW },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          membership: vi.fn(async () => membership({ role: "admin" })),
          listPendingInvitations: vi.fn(async () => [live, expired]),
        }),
        policy: makePolicy({ isEmailApproved: vi.fn(async () => true) }),
      },
    );
    expect(result.length).toBe(2);
    expect(result[0]?.status).toBe("pending");
    expect(result[1]?.status).toBe("expired");
  });
});

describe("revokeGroupInvitation", () => {
  it("revokes when the actor is an admin", async () => {
    const revoke = vi.fn();
    await revokeGroupInvitation(
      {
        actor: ACTOR_ID,
        groupId: GROUP_ID,
        invitationId: INVITE_ID,
        now: TEST_NOW,
      },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          membership: vi.fn(async () => membership({ role: "admin" })),
          invitationById: vi.fn(async () => invitation()),
          revokeInvitation: revoke,
        }),
        policy: makePolicy(),
      },
    );
    expect(revoke).toHaveBeenCalledWith({ id: INVITE_ID, by: ACTOR_ID, now: TEST_NOW });
  });

  it("rejects NOT_FOUND when the invitation belongs to a different group", async () => {
    await expect(
      revokeGroupInvitation(
        { actor: ACTOR_ID, groupId: GROUP_ID, invitationId: INVITE_ID, now: TEST_NOW },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            membership: vi.fn(async () => membership({ role: "admin" })),
            invitationById: vi.fn(async () =>
              invitation({ groupId: "g_other" as typeof GROUP_ID }),
            ),
          }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", reason: "invitation_not_found" });
  });
});

describe("setGroupAdmin", () => {
  it("returns the existing membership when role is unchanged (idempotent)", async () => {
    const target = membership({ userId: TARGET_ID, role: "admin" });
    const result = await setGroupAdmin(
      { actor: ACTOR_ID, groupId: GROUP_ID, target: TARGET_ID, role: "admin" },
      {
        users: makeUsers(ACTOR, TARGET),
        groups: makeGroups({
          membership: vi.fn(async (_g, uid) =>
            uid === ACTOR_ID ? membership({ role: "admin" }) : target,
          ),
          countAdmins: vi.fn(async () => 2),
          setMembershipRole: vi.fn(),
        }),
        policy: makePolicy(),
      },
    );
    expect(result).toEqual(target);
  });

  it("rejects orphaning the last admin via demotion (CONFLICT)", async () => {
    await expect(
      setGroupAdmin(
        { actor: ACTOR_ID, groupId: GROUP_ID, target: TARGET_ID, role: "participant" },
        {
          users: makeUsers(ACTOR, TARGET),
          groups: makeGroups({
            membership: vi.fn(async (_g, uid) =>
              uid === ACTOR_ID
                ? membership({ role: "admin" })
                : membership({ userId: TARGET_ID, role: "admin" }),
            ),
            countAdmins: vi.fn(async () => 1),
          }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", reason: "would_orphan_admin" });
  });
});

describe("updateGroupProfile", () => {
  it("calls updateProfile and queues prior avatar deletion", async () => {
    const updateProfile = vi.fn(async () =>
      membership({
        profile: { nickname: "new", avatarUrl: "new-key", bio: null, updatedAt: TEST_NOW },
      }),
    );
    const deleteKey = vi.fn();
    await updateGroupProfile(
      {
        actor: ACTOR_ID,
        groupId: GROUP_ID,
        target: ACTOR_ID,
        patch: { nickname: "new", avatarUrl: "new-key" },
      },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () =>
            membership({
              profile: { nickname: "old", avatarUrl: "old-key", bio: null, updatedAt: null },
            }),
          ),
          updateProfile,
        }),
        policy: makePolicy(),
        storage: makeStorage({ delete: deleteKey }),
      },
    );
    expect(updateProfile).toHaveBeenCalled();
    expect(deleteKey).toHaveBeenCalledWith("old-key");
  });

  it("rejects FORBIDDEN/not_self when editing someone else", async () => {
    await expect(
      updateGroupProfile(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          target: TARGET_ID,
          patch: { nickname: "x" },
        },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => membership()) }),
          policy: makePolicy(),
          storage: makeStorage(),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_self" });
  });

  it("rejects on archived groups", async () => {
    await expect(
      updateGroupProfile(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          target: ACTOR_ID,
          patch: { nickname: "x" },
        },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ARCHIVED_GROUP),
            membership: vi.fn(async () => membership()),
          }),
          policy: makePolicy(),
          storage: makeStorage(),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "group_archived" });
  });

  it("rejects an oversized bio", async () => {
    await expect(
      updateGroupProfile(
        {
          actor: ACTOR_ID,
          groupId: GROUP_ID,
          target: ACTOR_ID,
          patch: { bio: "x".repeat(801) },
        },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({ membership: vi.fn(async () => membership()) }),
          policy: makePolicy(),
          storage: makeStorage(),
        },
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION", reason: "invalid_bio" });
  });
});

describe("previewInvitation", () => {
  it("renders the projection for a live invitation", async () => {
    const result = await previewInvitation(
      { token: "tok-test", now: TEST_NOW },
      {
        groups: makeGroups({
          invitationByToken: vi.fn(async () => invitation()),
          byId: vi.fn(async () => ACTIVE_GROUP),
        }),
        policy: makePolicy({ isEmailApproved: vi.fn(async () => true) }),
      },
    );
    expect(result.groupName).toBe(ACTIVE_GROUP.name);
    expect(result.status).toBe("pending");
    expect(result.targetEmail).toBe("target@example.com");
    expect(result.inviterDisplayName).toBeNull();
  });

  it("rejects NOT_FOUND for an unknown token", async () => {
    await expect(
      previewInvitation(
        { token: "missing", now: TEST_NOW },
        {
          groups: makeGroups({ invitationByToken: vi.fn(async () => null) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", reason: "invitation_not_found" });
  });
});
