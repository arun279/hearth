import { describe, expect, it, vi } from "vitest";
import { removeGroupMember } from "../src/use-cases/remove-group-member.ts";
import {
  ACTIVE_GROUP,
  ACTOR,
  ACTOR_ID,
  GROUP_ID,
  makeGroups,
  makePolicy,
  makeTracks,
  makeUsers,
  membership,
  TARGET,
  TARGET_ID,
} from "./_helpers.ts";

describe("removeGroupMember", () => {
  it("removes a participant target via the admin actor", async () => {
    const removeMembership = vi.fn();
    const endAll = vi.fn(async () => 0);
    await removeGroupMember(
      { actor: ACTOR_ID, groupId: GROUP_ID, target: TARGET_ID },
      {
        users: makeUsers(ACTOR, TARGET),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async (_gid, uid) =>
            uid === ACTOR_ID
              ? membership({ role: "admin" })
              : membership({ userId: TARGET_ID, role: "participant" }),
          ),
          countAdmins: vi.fn(async () => 2),
          removeMembership,
        }),
        tracks: makeTracks({ endAllEnrollmentsForUser: endAll }),
        policy: makePolicy(),
      },
    );
    expect(removeMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: GROUP_ID,
        userId: TARGET_ID,
        attribution: "preserve_name",
        displayNameSnapshot: "Target",
      }),
    );
    expect(endAll).toHaveBeenCalledWith({ groupId: GROUP_ID, userId: TARGET_ID, by: ACTOR_ID });
  });

  it("rejects would_orphan_admin when removing the last admin (CONFLICT)", async () => {
    await expect(
      removeGroupMember(
        { actor: ACTOR_ID, groupId: GROUP_ID, target: TARGET_ID },
        {
          users: makeUsers(ACTOR, TARGET),
          groups: makeGroups({
            membership: vi.fn(async (_gid, uid) =>
              uid === ACTOR_ID
                ? membership({ role: "admin" })
                : membership({ userId: TARGET_ID, role: "admin" }),
            ),
            countAdmins: vi.fn(async () => 1),
          }),
          tracks: makeTracks(),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", reason: "would_orphan_admin" });
  });

  it("rejects FORBIDDEN/not_group_admin for a non-admin actor", async () => {
    await expect(
      removeGroupMember(
        { actor: ACTOR_ID, groupId: GROUP_ID, target: TARGET_ID },
        {
          users: makeUsers(ACTOR, TARGET),
          groups: makeGroups({
            membership: vi.fn(async (_gid, uid) =>
              uid === ACTOR_ID
                ? membership({ role: "participant" })
                : membership({ userId: TARGET_ID, role: "participant" }),
            ),
            countAdmins: vi.fn(async () => 2),
          }),
          tracks: makeTracks(),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_group_admin" });
  });

  it("calls endAllEnrollmentsForUser exactly once even with zero enrollments (M5-readiness)", async () => {
    const endAll = vi.fn(async () => 0);
    await removeGroupMember(
      { actor: ACTOR_ID, groupId: GROUP_ID, target: TARGET_ID },
      {
        users: makeUsers(ACTOR, TARGET),
        groups: makeGroups({
          membership: vi.fn(async (_gid, uid) =>
            uid === ACTOR_ID
              ? membership({ role: "admin" })
              : membership({ userId: TARGET_ID, role: "participant" }),
          ),
          countAdmins: vi.fn(async () => 2),
        }),
        tracks: makeTracks({ endAllEnrollmentsForUser: endAll }),
        policy: makePolicy(),
      },
    );
    expect(endAll).toHaveBeenCalledTimes(1);
  });

  it("uses the explicit attribution override when provided", async () => {
    const removeMembership = vi.fn();
    await removeGroupMember(
      { actor: ACTOR_ID, groupId: GROUP_ID, target: TARGET_ID, attribution: "anonymize" },
      {
        users: makeUsers(ACTOR, TARGET),
        groups: makeGroups({
          membership: vi.fn(async (_gid, uid) =>
            uid === ACTOR_ID
              ? membership({ role: "admin" })
              : membership({ userId: TARGET_ID, role: "participant" }),
          ),
          countAdmins: vi.fn(async () => 2),
          removeMembership,
        }),
        tracks: makeTracks(),
        policy: makePolicy(),
      },
    );
    expect(removeMembership).toHaveBeenCalledWith(
      expect.objectContaining({ attribution: "anonymize" }),
    );
  });
});
