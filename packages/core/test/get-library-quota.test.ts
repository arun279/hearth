import { DomainError } from "@hearth/domain";
import { describe, expect, it, vi } from "vitest";
import { getLibraryQuota } from "../src/use-cases/get-library-quota.ts";
import {
  ACTIVE_GROUP,
  ACTOR,
  ACTOR_ID,
  GROUP_ID,
  makeGroups,
  makePolicy,
  makeStorage,
  makeUsers,
  membership,
} from "./_helpers.ts";

describe("getLibraryQuota", () => {
  it("returns the live storage usage with budget defaults from domain", async () => {
    const out = await getLibraryQuota(
      { actor: ACTOR_ID, groupId: GROUP_ID },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        policy: makePolicy(),
        storage: makeStorage({ usedBytes: vi.fn(async () => 1_234_567) }),
      },
    );
    expect(out.usedBytes).toBe(1_234_567);
    expect(out.budgetBytes).toBeGreaterThan(0);
    expect(out.maxItemBytes).toBeGreaterThan(0);
    expect(out.tripRatio).toBeGreaterThan(0);
    expect(out.availableBytes).toBe(Math.max(0, out.budgetBytes * out.tripRatio - out.usedBytes));
  });

  it("respects budget overrides and clamps available bytes at zero when over the trip", async () => {
    const out = await getLibraryQuota(
      {
        actor: ACTOR_ID,
        groupId: GROUP_ID,
        budgetBytes: 1_000,
        budgetTripRatio: 0.9,
      },
      {
        users: makeUsers(ACTOR),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          membership: vi.fn(async () => membership({ role: "participant" })),
        }),
        policy: makePolicy(),
        storage: makeStorage({ usedBytes: vi.fn(async () => 5_000) }),
      },
    );
    expect(out.budgetBytes).toBe(1_000);
    expect(out.tripRatio).toBe(0.9);
    expect(out.availableBytes).toBe(0);
  });

  it("rejects a non-member with the standard not-found mask", async () => {
    await expect(
      getLibraryQuota(
        { actor: ACTOR_ID, groupId: GROUP_ID },
        {
          users: makeUsers(ACTOR),
          groups: makeGroups({
            byId: vi.fn(async () => ACTIVE_GROUP),
            membership: vi.fn(async () => null),
          }),
          policy: makePolicy(),
          storage: makeStorage(),
        },
      ),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
