import { describe, expect, it, vi } from "vitest";
import { leaveGroup } from "../src/use-cases/leave-group.ts";
import {
  ACTOR,
  ACTOR_ID,
  GROUP_ID,
  makeGroups,
  makePolicy,
  makeTracks,
  makeUsers,
  membership,
} from "./_helpers.ts";

describe("leaveGroup", () => {
  it("removes the actor's own membership and cascades enrollments", async () => {
    const removeMembership = vi.fn();
    const endAll = vi.fn(async () => 0);
    await leaveGroup(
      { actor: ACTOR_ID, groupId: GROUP_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          membership: vi.fn(async () => membership({ role: "participant" })),
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
        userId: ACTOR_ID,
        attribution: "preserve_name",
      }),
    );
    expect(endAll).toHaveBeenCalledTimes(1);
  });

  it("blocks the last admin from leaving (CONFLICT/would_orphan_admin)", async () => {
    await expect(
      leaveGroup(
        { actor: ACTOR_ID, groupId: GROUP_ID },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            membership: vi.fn(async () => membership({ role: "admin" })),
            countAdmins: vi.fn(async () => 1),
          }),
          tracks: makeTracks(),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", reason: "would_orphan_admin" });
  });

  it("respects an explicit attribution override", async () => {
    const removeMembership = vi.fn();
    await leaveGroup(
      { actor: ACTOR_ID, groupId: GROUP_ID, attribution: "anonymize" },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          membership: vi.fn(async () => membership({ role: "participant" })),
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
