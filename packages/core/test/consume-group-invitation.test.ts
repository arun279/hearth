import { describe, expect, it, vi } from "vitest";
import { consumeGroupInvitation } from "../src/use-cases/consume-group-invitation.ts";
import {
  ACTIVE_GROUP,
  ACTOR_ID,
  GROUP_ID,
  invitation,
  makeGroups,
  makePolicy,
  makeUsers,
  membership,
  TARGET,
  TARGET_ID,
  TEST_NOW,
} from "./_helpers.ts";

describe("consumeGroupInvitation", () => {
  it("consumes a live invitation and returns the new membership", async () => {
    const expected = membership({ userId: TARGET_ID });
    const consume = vi.fn(async () => ({ membership: expected, enrollment: null }));
    const result = await consumeGroupInvitation(
      { actor: TARGET_ID, token: "tok-test", now: TEST_NOW },
      {
        users: makeUsers(TARGET),
        groups: makeGroups({
          byId: vi.fn(async () => ACTIVE_GROUP),
          invitationByToken: vi.fn(async () => invitation()),
          consumeInvitation: consume,
        }),
        policy: makePolicy({ isEmailApproved: vi.fn(async () => true) }),
      },
    );
    expect(result.membership).toEqual(expected);
    expect(result.enrollment).toBeNull();
    expect(consume).toHaveBeenCalledWith({
      invitationId: expect.any(String),
      userId: TARGET_ID,
      now: TEST_NOW,
    });
  });

  it("rejects FORBIDDEN/invitation_email_mismatch when emails differ", async () => {
    await expect(
      consumeGroupInvitation(
        { actor: TARGET_ID, token: "tok-test", now: TEST_NOW },
        {
          users: makeUsers({ ...TARGET, email: "wrong@example.com" }),
          groups: makeGroups({ invitationByToken: vi.fn(async () => invitation()) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "invitation_email_mismatch" });
  });

  it("rejects CONFLICT/invitation_revoked", async () => {
    await expect(
      consumeGroupInvitation(
        { actor: TARGET_ID, token: "tok-test", now: TEST_NOW },
        {
          users: makeUsers(TARGET),
          groups: makeGroups({
            invitationByToken: vi.fn(async () => invitation({ revokedAt: TEST_NOW })),
          }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", reason: "invitation_revoked" });
  });

  it("rejects CONFLICT/invitation_consumed", async () => {
    await expect(
      consumeGroupInvitation(
        { actor: TARGET_ID, token: "tok-test", now: TEST_NOW },
        {
          users: makeUsers(TARGET),
          groups: makeGroups({
            invitationByToken: vi.fn(async () => invitation({ consumedAt: TEST_NOW })),
          }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", reason: "invitation_consumed" });
  });

  it("rejects CONFLICT/invitation_expired", async () => {
    await expect(
      consumeGroupInvitation(
        { actor: TARGET_ID, token: "tok-test", now: TEST_NOW },
        {
          users: makeUsers(TARGET),
          groups: makeGroups({
            invitationByToken: vi.fn(async () =>
              invitation({ expiresAt: new Date(TEST_NOW.getTime() - 1) }),
            ),
          }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", reason: "invitation_expired" });
  });

  it("rejects FORBIDDEN/email_not_approved_yet when the email isn't approved", async () => {
    await expect(
      consumeGroupInvitation(
        { actor: TARGET_ID, token: "tok-test", now: TEST_NOW },
        {
          users: makeUsers(TARGET),
          groups: makeGroups({ invitationByToken: vi.fn(async () => invitation()) }),
          policy: makePolicy({ isEmailApproved: vi.fn(async () => false) }),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "email_not_approved_yet" });
  });

  it("rejects NOT_FOUND when the token is unknown", async () => {
    await expect(
      consumeGroupInvitation(
        { actor: TARGET_ID, token: "missing", now: TEST_NOW },
        {
          users: makeUsers(TARGET),
          groups: makeGroups({ invitationByToken: vi.fn(async () => null) }),
          policy: makePolicy(),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", reason: "invitation_not_found" });
  });

  it("ignores the actor email when the invitation has no email (open invitation)", async () => {
    const expected = membership({ userId: TARGET_ID });
    const consume = vi.fn(async () => ({ membership: expected, enrollment: null }));
    await consumeGroupInvitation(
      { actor: TARGET_ID, token: "tok-test", now: TEST_NOW },
      {
        users: makeUsers(TARGET),
        groups: makeGroups({
          invitationByToken: vi.fn(async () => invitation({ email: null })),
          consumeInvitation: consume,
        }),
        policy: makePolicy({ isEmailApproved: vi.fn(async () => false) }),
      },
    );
    expect(consume).toHaveBeenCalled();
  });
});

// Quiet the linter: ACTOR_ID + GROUP_ID are unused here but kept exported in
// `_helpers.ts` so other tests can reuse them.
void ACTOR_ID;
void GROUP_ID;
