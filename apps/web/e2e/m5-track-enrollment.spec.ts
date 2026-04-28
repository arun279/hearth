import { expect, test } from "@playwright/test";
import { attachSession, demoteToMember, resetInstanceState, seedOperator } from "./auth.ts";

const ADMIN_USER = {
  userId: "u_e2e_m5_admin",
  email: "m5-admin@e2e.example.com",
  name: "M5 Admin",
};

const MEMBER_USER = {
  userId: "u_e2e_m5_member",
  email: "m5-member@e2e.example.com",
  name: "M5 Member",
};

test.describe("M5 — Track enrollment", () => {
  test.beforeEach(() => {
    resetInstanceState();
  });

  test("a member self-enrolls in a track, sees facilitator entries, then leaves", async ({
    browser,
  }) => {
    // Admin seeds the group + track + adds the member.
    const admin = await seedOperator(ADMIN_USER);
    const adminCtx = await browser.newContext();
    await attachSession(adminCtx, admin.cookie);

    const groupRes = await adminCtx.request.post("/api/v1/g", {
      data: { name: "Tuesday Night Learners" },
      headers: { "content-type": "application/json" },
    });
    expect(groupRes.status()).toBe(201);
    const { id: groupId } = (await groupRes.json()) as { id: string };

    const trackRes = await adminCtx.request.post(`/api/v1/g/${groupId}/tracks`, {
      data: { name: "Beginner Spanish", description: "First steps." },
      headers: { "content-type": "application/json" },
    });
    expect(trackRes.status()).toBe(201);
    const { id: trackId } = (await trackRes.json()) as { id: string };

    // Approve the member's email so consume succeeds.
    const approve = await adminCtx.request.post("/api/v1/instance/approved-emails", {
      data: { email: MEMBER_USER.email },
      headers: { "content-type": "application/json" },
    });
    expect(approve.status()).toBe(201);

    // Seed the member user (auto-seeded as operator by `seedOperator`),
    // then demote so they're a plain user. Same pattern as M3 specs.
    const member = await seedOperator(MEMBER_USER);
    demoteToMember(member.userId);

    const inviteRes = await adminCtx.request.post(`/api/v1/g/${groupId}/invitations`, {
      data: { email: MEMBER_USER.email },
      headers: { "content-type": "application/json" },
    });
    expect(inviteRes.status()).toBe(201);
    const minted = (await inviteRes.json()) as { invitation: { token: string } };
    const token = minted.invitation.token;

    const memberCtx = await browser.newContext();
    await attachSession(memberCtx, member.cookie);
    const consume = await memberCtx.request.post("/api/v1/invitations/consume", {
      data: { token },
      headers: { "content-type": "application/json" },
    });
    expect(consume.status()).toBe(201);

    const memberPage = await memberCtx.newPage();
    await memberPage.goto(`/g/${groupId}/t/${trackId}`);

    // Member-no-enrollment view: track header has an "Enroll" primary
    // button; the People card link is also visible.
    const enrollButton = memberPage.getByRole("button", { name: /^Enroll$/ });
    await expect(enrollButton).toBeVisible();
    await enrollButton.click();
    await expect(memberPage.getByText(/Enrolled in Beginner Spanish/i)).toBeVisible();

    // After enrolling: Leave button replaces Enroll. Counter bumps.
    await expect(memberPage.getByRole("button", { name: /^Leave$/ })).toBeVisible();
    await expect(enrollButton).toBeHidden();

    // Open the People page and confirm the row is there with role.
    await memberPage.getByRole("link", { name: /^People$/ }).click();
    await expect(memberPage).toHaveURL(new RegExp(`/g/${groupId}/t/${trackId}/people$`));
    await expect(memberPage.getByRole("heading", { name: "People" })).toBeVisible();
    // Member shows under "Enrolled" with their display name.
    const participants = memberPage.getByLabel("Participants");
    await expect(participants.getByText(MEMBER_USER.name)).toBeVisible();
    // Admin (the only facilitator) is listed in the Facilitators section.
    const facilitators = memberPage.getByLabel("Facilitators");
    await expect(facilitators.getByText(ADMIN_USER.name)).toBeVisible();

    // Leave from the dashed callout footer at the bottom of the People
    // page → confirm dialog → toast → redirect to non-enrolled view.
    await memberPage.getByRole("button", { name: /Leave Beginner Spanish/i }).click();
    const leaveDialog = memberPage.getByRole("dialog", { name: /Leave Beginner Spanish/i });
    await expect(leaveDialog).toBeVisible();
    // No type-to-confirm (reversible action) — the confirm button is enabled immediately.
    await leaveDialog.getByRole("button", { name: /Leave track/i }).click();
    await expect(memberPage.getByText(/You left Beginner Spanish/i)).toBeVisible();

    // Back on the track home, the "Enroll" button is back.
    await memberPage.goto(`/g/${groupId}/t/${trackId}`);
    await expect(memberPage.getByRole("button", { name: /^Enroll$/ })).toBeVisible();
    await expect(memberPage.getByRole("button", { name: /^Leave$/ })).toBeHidden();
  });

  test("an admin promotes a participant; the last facilitator cannot demote", async ({
    browser,
  }) => {
    const admin = await seedOperator(ADMIN_USER);
    const adminCtx = await browser.newContext();
    await attachSession(adminCtx, admin.cookie);

    const groupRes = await adminCtx.request.post("/api/v1/g", {
      data: { name: "Tuesday Night Learners" },
      headers: { "content-type": "application/json" },
    });
    const { id: groupId } = (await groupRes.json()) as { id: string };

    const trackRes = await adminCtx.request.post(`/api/v1/g/${groupId}/tracks`, {
      data: { name: "Beginner Spanish" },
      headers: { "content-type": "application/json" },
    });
    const { id: trackId } = (await trackRes.json()) as { id: string };

    // Last-facilitator demote attempt: the admin/creator is the sole
    // facilitator on an active track. The People page row's Demote
    // button is gated client-side via capability flags; an attempt at
    // the API returns 409 with `would_orphan_facilitator`.
    const demote = await adminCtx.request.delete(
      `/api/v1/tracks/${trackId}/facilitators/${ADMIN_USER.userId}`,
    );
    expect(demote.status()).toBe(409);
    const demoteBody = (await demote.json()) as { code: string };
    expect(demoteBody.code).toBe("would_orphan_facilitator");

    // Add a second member, promote them, then demote should succeed for
    // the original. Tests the orphan invariant lifts once a replacement
    // exists.
    await adminCtx.request.post("/api/v1/instance/approved-emails", {
      data: { email: MEMBER_USER.email },
      headers: { "content-type": "application/json" },
    });
    const member = await seedOperator(MEMBER_USER);
    demoteToMember(member.userId);
    const inviteRes = await adminCtx.request.post(`/api/v1/g/${groupId}/invitations`, {
      data: { email: MEMBER_USER.email },
      headers: { "content-type": "application/json" },
    });
    const minted = (await inviteRes.json()) as { invitation: { token: string } };
    const token = minted.invitation.token;

    const memberCtx = await browser.newContext();
    await attachSession(memberCtx, member.cookie);
    const consumed = await memberCtx.request.post("/api/v1/invitations/consume", {
      data: { token },
      headers: { "content-type": "application/json" },
    });
    expect(consumed.status()).toBe(201);

    // Member self-enrolls.
    const enroll = await memberCtx.request.post(`/api/v1/tracks/${trackId}/enroll`, {
      data: {},
      headers: { "content-type": "application/json" },
    });
    expect(enroll.status()).toBe(201);

    // Admin promotes the member to facilitator.
    const promote = await adminCtx.request.post(`/api/v1/tracks/${trackId}/facilitators`, {
      data: { targetUserId: MEMBER_USER.userId },
      headers: { "content-type": "application/json" },
    });
    expect(promote.status()).toBe(200);

    // Now the original facilitator can be demoted (count >= 2).
    const demote2 = await adminCtx.request.delete(
      `/api/v1/tracks/${trackId}/facilitators/${ADMIN_USER.userId}`,
    );
    expect(demote2.status()).toBe(200);

    // /me/context now reports a single active enrollment for the admin.
    const meRes = await adminCtx.request.get("/api/v1/me/context");
    const meBody = (await meRes.json()) as {
      data: { enrollments: ReadonlyArray<{ trackId: string; role: string }> };
    };
    const adminEnrollment = meBody.data.enrollments.find((e) => e.trackId === trackId);
    expect(adminEnrollment?.role).toBe("participant");
  });
});
