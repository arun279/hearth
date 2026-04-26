import { describe, expect, it, vi } from "vitest";
import { listMyGroups } from "../src/use-cases/list-my-groups.ts";
import { ACTIVE_GROUP, ACTOR_ID, makeGroups } from "./_helpers.ts";

describe("listMyGroups", () => {
  it("returns the groups the actor holds an active membership in", async () => {
    const listForUser = vi.fn(async () => [ACTIVE_GROUP]);
    const result = await listMyGroups({ actor: ACTOR_ID }, { groups: makeGroups({ listForUser }) });
    expect(result).toEqual([ACTIVE_GROUP]);
    expect(listForUser).toHaveBeenCalledWith(ACTOR_ID);
  });

  it("returns an empty array when the user has no memberships", async () => {
    const result = await listMyGroups(
      { actor: ACTOR_ID },
      { groups: makeGroups({ listForUser: vi.fn(async () => []) }) },
    );
    expect(result).toEqual([]);
  });
});
