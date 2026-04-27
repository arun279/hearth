import { expect, test } from "@playwright/test";
import {
  attachSession,
  demoteToMember,
  resetInstanceState,
  seedOperator,
  unapproveEmail,
} from "./auth.ts";

const OPERATOR = {
  userId: "u_e2e_op_m3",
  email: "operator-m3@e2e.example.com",
  name: "M3 Operator",
};

const INVITEE = {
  userId: "u_e2e_invitee_m3",
  email: "invitee-m3@e2e.example.com",
  name: "M3 Invitee",
};

test.describe("M3 — invite, approve, consume, members list", () => {
  test.beforeEach(() => {
    resetInstanceState();
  });

  test("operator invites → approves email → invitee accepts → appears in members list with AvatarUploader", async ({
    browser,
  }) => {
    // The end-to-end M3 happy path: an operator stands up a group, primes
    // the Approved Email gate, mints an invitation, then a separate user
    // accepts and lands on the People page as a member with their avatar
    // affordance present. Each handoff between actors is a real Playwright
    // BrowserContext so cookie boundaries match production.
    const op = await seedOperator(OPERATOR);
    const opCtx = await browser.newContext();
    await attachSession(opCtx, op.cookie);

    // 1. Operator creates a group.
    const create = await opCtx.request.post("/api/v1/g", {
      data: { name: "Tuesday Night Learners" },
      headers: { "content-type": "application/json" },
    });
    expect(create.status()).toBe(201);
    const { id: groupId } = (await create.json()) as { id: string };

    // 2. Operator approves the invitee's email so consume can succeed.
    //    Without this, `canConsumeInvitation` rejects with `email_not_approved_yet`.
    const approve = await opCtx.request.post("/api/v1/instance/approved-emails", {
      data: { email: INVITEE.email },
      headers: { "content-type": "application/json" },
    });
    expect(approve.status()).toBe(201);

    // 3. Operator mints an invitation targeted at the invitee email.
    const mint = await opCtx.request.post(`/api/v1/g/${groupId}/invitations`, {
      data: { email: INVITEE.email },
      headers: { "content-type": "application/json" },
    });
    expect(mint.status()).toBe(201);
    const minted = (await mint.json()) as {
      readonly invitation: { readonly token: string };
      readonly emailApproved: boolean;
    };
    expect(minted.emailApproved).toBe(true);
    const token = minted.invitation.token;

    // 4. Switch actors. The invitee is signed in but *not* an operator —
    //    `seedOperator` plus `demoteToMember` is the established pattern
    //    for "real user, no operator powers".
    const invitee = await seedOperator(INVITEE);
    demoteToMember(invitee.userId);
    const inviteeCtx = await browser.newContext();
    await attachSession(inviteeCtx, invitee.cookie);
    const page = await inviteeCtx.newPage();

    // 5. Invitee lands on the consume URL and accepts.
    await page.goto(`/invite/${token}`);
    await expect(
      page.getByRole("heading", { name: /Join Tuesday Night Learners\?/i }),
    ).toBeVisible();
    // Page-title contract from the M3 design-review fixes: route-specific
    // titles distinguish history entries.
    await expect(page).toHaveTitle(/Invitation — Tuesday Night Learners — Hearth/);

    await page.getByRole("button", { name: /Accept invitation/i }).click();

    // After consume the SPA navigates to `/` so the new group appears in
    // the sidebar via the `/me/context` invalidation.
    await expect(page).toHaveURL("/");
    const yourGroupsNav = page.getByRole("navigation", { name: "Your groups" });
    await expect(yourGroupsNav.getByRole("link", { name: "Tuesday Night Learners" })).toBeVisible();

    // 6. Open the People page and verify the invitee is listed with the
    //    AvatarUploader affordance for self-service avatar updates.
    await page.goto(`/g/${groupId}/people`);
    await expect(page).toHaveTitle(/People — Tuesday Night Learners — Hearth/);
    await expect(page.getByRole("heading", { name: /^People$/i })).toBeVisible();

    const peopleList = page.getByRole("list", { name: "Group members" });
    await expect(peopleList).toBeVisible();
    await expect(peopleList.getByText(INVITEE.name)).toBeVisible();
    await expect(peopleList.getByText(/^you$/i)).toBeVisible();

    // The AvatarUploader is gated by the user's own membership row; it
    // renders the "Your avatar in {group}" label and a focusable "Change"
    // Button. We assert the affordance is present without exercising the
    // R2 PUT (covered by adapter-level integration tests).
    await expect(page.getByText(`Your avatar in Tuesday Night Learners`)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Change$/i })).toBeVisible();

    // 7. The invitee is a participant, not an operator, so manage/invite
    //    affordances must be absent. This guards CR#1's operator-vs-admin
    //    distinction from drifting back into "any signed-in user manages
    //    membership".
    await expect(page.getByRole("button", { name: /Manage members/i })).toBeHidden();
    await expect(page.getByRole("button", { name: /^\+ Invite$/i })).toBeHidden();

    await opCtx.close();
    await inviteeCtx.close();
  });

  test("invitee whose email is not yet approved sees the awaiting-approval callout", async ({
    browser,
  }) => {
    // Negative path: the operator skips the approve-email step. The
    // preview returns `pending_approval`, the SPA shows the warning, and
    // the Accept button is disabled.
    const op = await seedOperator(OPERATOR);
    const opCtx = await browser.newContext();
    await attachSession(opCtx, op.cookie);

    const create = await opCtx.request.post("/api/v1/g", {
      data: { name: "Quiet Study" },
      headers: { "content-type": "application/json" },
    });
    expect(create.status()).toBe(201);
    const { id: groupId } = (await create.json()) as { id: string };

    // The shared seed helper auto-approves the user's email, but this
    // spec needs the gate to *fail* — drop the row directly so the
    // preview returns `pending_approval`.
    const invitee = await seedOperator(INVITEE);
    demoteToMember(invitee.userId);
    unapproveEmail(INVITEE.email);

    const mint = await opCtx.request.post(`/api/v1/g/${groupId}/invitations`, {
      data: { email: INVITEE.email },
      headers: { "content-type": "application/json" },
    });
    expect(mint.status()).toBe(201);
    const minted = (await mint.json()) as {
      readonly invitation: { readonly token: string };
      readonly emailApproved: boolean;
    };
    expect(minted.emailApproved).toBe(false);

    const inviteeCtx = await browser.newContext();
    await attachSession(inviteeCtx, invitee.cookie);
    const page = await inviteeCtx.newPage();

    await page.goto(`/invite/${minted.invitation.token}`);
    await expect(page.getByText(/Awaiting Approved Email/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Accept invitation/i })).toBeDisabled();

    await opCtx.close();
    await inviteeCtx.close();
  });

  test("revoked invitation lands on the revoked branch", async ({ browser }) => {
    const op = await seedOperator(OPERATOR);
    const opCtx = await browser.newContext();
    await attachSession(opCtx, op.cookie);

    const create = await opCtx.request.post("/api/v1/g", {
      data: { name: "Revoked Group" },
      headers: { "content-type": "application/json" },
    });
    const { id: groupId } = (await create.json()) as { id: string };

    const mint = await opCtx.request.post(`/api/v1/g/${groupId}/invitations`, {
      data: { email: INVITEE.email },
      headers: { "content-type": "application/json" },
    });
    const minted = (await mint.json()) as {
      readonly invitation: { readonly id: string; readonly token: string };
    };

    const revoke = await opCtx.request.delete(
      `/api/v1/g/${groupId}/invitations/${minted.invitation.id}`,
    );
    expect(revoke.status()).toBe(204);

    const invitee = await seedOperator(INVITEE);
    demoteToMember(invitee.userId);
    const inviteeCtx = await browser.newContext();
    await attachSession(inviteeCtx, invitee.cookie);
    const page = await inviteeCtx.newPage();

    await page.goto(`/invite/${minted.invitation.token}`);
    await expect(page.getByRole("heading", { name: /This invitation was revoked/i })).toBeVisible();
    // The forward link from the M3 design-review fix is present on every
    // terminal landing — guards against the dead-end regression.
    await expect(page.getByRole("link", { name: /Go to your groups/i })).toBeVisible();

    await opCtx.close();
    await inviteeCtx.close();
  });

  test("admin can copy a pending invitation's link from the people page", async ({ browser }) => {
    const op = await seedOperator(OPERATOR);
    const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    await attachSession(ctx, op.cookie);

    const create = await ctx.request.post("/api/v1/g", {
      data: { name: "Copy-link group" },
      headers: { "content-type": "application/json" },
    });
    const { id: groupId } = (await create.json()) as { id: string };

    await ctx.request.post(`/api/v1/g/${groupId}/invitations`, {
      data: { email: INVITEE.email },
      headers: { "content-type": "application/json" },
    });

    const page = await ctx.newPage();
    await page.goto(`/g/${groupId}/people`);
    const invitations = page.getByRole("list", { name: /Outstanding invitations/i });
    await expect(invitations).toBeVisible();
    const copyButton = invitations.getByRole("button", { name: /Copy invite link for/i });
    await expect(copyButton).toBeVisible();
    await copyButton.click();
    await expect(page.getByText(/Invitation link copied/i)).toBeVisible();

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toMatch(/\/invite\/[A-Za-z0-9_-]+$/);

    await ctx.close();
  });
});
