import { expect, test } from "@playwright/test";
import { attachSession, demoteToMember, resetInstanceState, seedOperator } from "./auth.ts";

const BOOTSTRAP_USER = {
  userId: "u_e2e_op_bootstrap",
  email: "bootstrap@e2e.example.com",
  name: "Bootstrap Operator",
};

test.describe("M4 — Track lifecycle", () => {
  test.beforeEach(() => {
    resetInstanceState();
  });

  test("admin creates a track, pauses it, resumes, then archives", async ({ browser }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    // Seed a group via API so we land directly on the empty group home.
    const create = await context.request.post("/api/v1/g", {
      data: { name: "Tuesday Night Learners" },
      headers: { "content-type": "application/json" },
    });
    expect(create.status()).toBe(201);
    const { id: groupId } = (await create.json()) as { id: string };

    await page.goto(`/g/${groupId}`);
    await expect(page.getByRole("heading", { name: "Tuesday Night Learners" })).toBeVisible();
    await expect(page.getByText(/No tracks yet/i)).toBeVisible();

    // Open the create-track dialog from the section header.
    await page.getByRole("button", { name: /Create a Learning Track/i }).click();
    const createDialog = page.getByRole("dialog", { name: /Create a Learning Track/i });
    await expect(createDialog).toBeVisible();
    await createDialog.getByRole("textbox", { name: /^Name$/i }).fill("Beginner Spanish");
    await createDialog
      .getByRole("textbox", { name: /^Description/i })
      .fill("A patient pace through the basics.");
    await createDialog.getByRole("button", { name: /Create Learning Track/i }).click();

    // Toast + redirect to the new track's home; the breadcrumb shows the
    // group → track lineage and the title is the track name.
    await expect(page.getByText(/Created "Beginner Spanish"/i)).toBeVisible();
    await expect(page).toHaveURL(/\/g\/[^/]+\/t\/[^/]+/);
    await expect(page.getByRole("heading", { name: "Beginner Spanish" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: /Breadcrumb/i })).toContainText(
      "Tuesday Night Learners",
    );

    // Active badge inline with the title; no status banner above.
    await expect(page.getByText(/^active$/i).first()).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /Paused/i })).toBeHidden();

    // Tab bar: four tabs visible, Activities is the default panel and shows
    // an empty state.
    const tabList = page.getByRole("tablist", { name: "Track sections" });
    await expect(tabList.getByRole("tab", { name: /Activities/i })).toBeVisible();
    await expect(tabList.getByRole("tab", { name: /Sessions/i })).toBeVisible();
    await expect(tabList.getByRole("tab", { name: /Library/i })).toBeVisible();
    await expect(tabList.getByRole("tab", { name: /Pending/i })).toBeVisible();
    await expect(page.getByText(/No activities yet/i)).toBeVisible();

    // Pause via settings dialog: select the Paused radio, then commit with
    // Save changes — settings stage rather than auto-save so the user
    // controls when each change lands.
    await page.getByRole("button", { name: /Track settings/i }).click();
    const settings = page.getByRole("dialog", { name: /Track settings/i });
    await expect(settings).toBeVisible();
    await settings.getByRole("radio", { name: /^Paused/i }).check();
    await settings.getByRole("button", { name: /Save changes/i }).click();
    await expect(page.getByText(/Track updated/i)).toBeVisible();
    // The status callout (role="status" via Callout's warn tone) replaces
    // the active state.
    await expect(page.getByRole("status").filter({ hasText: /Paused/i })).toBeVisible();

    // Resume by re-opening settings and flipping the radio back.
    await page.getByRole("button", { name: /Track settings/i }).click();
    const settingsAgain = page.getByRole("dialog", { name: /Track settings/i });
    await expect(settingsAgain).toBeVisible();
    await settingsAgain.getByRole("radio", { name: /^Active/i }).check();
    await settingsAgain.getByRole("button", { name: /Save changes/i }).click();
    await expect(page.getByText(/Track updated/i).last()).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /Paused/i })).toBeHidden();

    // Archive — terminal action keeps its dedicated confirmation flow,
    // separate from the staged Save above.
    await page.getByRole("button", { name: /Track settings/i }).click();
    const settingsForArchive = page.getByRole("dialog", { name: /Track settings/i });
    await expect(settingsForArchive).toBeVisible();
    await settingsForArchive.getByRole("button", { name: /Archive track/i }).click();
    const confirmArchive = page.getByRole("dialog", { name: /Archive this Learning Track/i });
    await expect(confirmArchive).toBeVisible();
    await confirmArchive.getByRole("button", { name: /^Archive track$/i }).click();
    await expect(page.getByText(/Track archived/i)).toBeVisible();
    // Archived tracks render the neutral "Archived" callout above the hero
    // and remove the editable affordances. The settings button stays
    // visible (the dialog now opens read-only) so the operator can still
    // inspect the track configuration.
    await expect(page.getByText(/^Archived$/).first()).toBeVisible();

    await context.close();
  });

  test("non-member visiting a track sees a 404 — no existence leak", async ({ browser }) => {
    // Operator A creates the group + track; member B (no membership)
    // probes by id. Both UI and API must return the not-found shape.
    const opA = await seedOperator(BOOTSTRAP_USER);
    const ctxA = await browser.newContext();
    await attachSession(ctxA, opA.cookie);

    const groupRes = await ctxA.request.post("/api/v1/g", {
      data: { name: "Private group" },
      headers: { "content-type": "application/json" },
    });
    const { id: groupId } = (await groupRes.json()) as { id: string };
    const trackRes = await ctxA.request.post(`/api/v1/g/${groupId}/tracks`, {
      data: { name: "Private track" },
      headers: { "content-type": "application/json" },
    });
    expect(trackRes.status()).toBe(201);
    const { id: trackId } = (await trackRes.json()) as { id: string };
    await ctxA.close();

    // Member B is signed in but not in the group AND not an operator —
    // operators can view any track via `canViewTrack`'s operator carve-out,
    // so without demoting we'd be exercising the wrong path.
    const memberB = await seedOperator({
      userId: "u_e2e_member_b",
      email: "memberb@e2e.example.com",
      name: "Member B",
    });
    demoteToMember(memberB.userId);
    const ctxB = await browser.newContext();
    await attachSession(ctxB, memberB.cookie);

    const probe = await ctxB.request.get(`/api/v1/tracks/${trackId}`);
    expect(probe.status()).toBe(404);
    const body = (await probe.json()) as { code: string };
    expect(body.code).toBe("not_group_member");

    const pageB = await ctxB.newPage();
    await pageB.goto(`/g/${groupId}/t/${trackId}`);
    await expect(pageB.getByText(/Track not found/i)).toBeVisible();

    await ctxB.close();
  });

  test("non-admin member does not see the New track CTA", async ({ browser }) => {
    // The bootstrap operator creates a group, then we add another user
    // as a participant via the admin members API. That user's group home
    // hides the New-track button (server still 403s if they try anyway).
    const op = await seedOperator(BOOTSTRAP_USER);
    const ctxOp = await browser.newContext();
    await attachSession(ctxOp, op.cookie);

    const create = await ctxOp.request.post("/api/v1/g", {
      data: { name: "Mixed group" },
      headers: { "content-type": "application/json" },
    });
    const { id: groupId } = (await create.json()) as { id: string };

    // Bring in a participant via invite + consume so the membership row
    // is created the way real users get in.
    const member = await seedOperator({
      userId: "u_e2e_member_only",
      email: "member-only@e2e.example.com",
      name: "Just A Member",
    });
    const inviteRes = await ctxOp.request.post(`/api/v1/g/${groupId}/invitations`, {
      data: { email: member.email },
      headers: { "content-type": "application/json" },
    });
    const minted = (await inviteRes.json()) as { invitation: { token: string } };
    demoteToMember(member.userId);
    const ctxMember = await browser.newContext();
    await attachSession(ctxMember, member.cookie);
    const consume = await ctxMember.request.post("/api/v1/invitations/consume", {
      data: { token: minted.invitation.token },
      headers: { "content-type": "application/json" },
    });
    expect(consume.status()).toBe(201);

    const pageMember = await ctxMember.newPage();
    await pageMember.goto(`/g/${groupId}`);
    await expect(pageMember.getByRole("heading", { name: "Mixed group" })).toBeVisible();
    await expect(pageMember.getByRole("button", { name: /Create a Learning Track/i })).toBeHidden();

    // The server also rejects a direct API attempt with the canonical
    // policy denial code.
    const reject = await ctxMember.request.post(`/api/v1/g/${groupId}/tracks`, {
      data: { name: "Sneaky" },
      headers: { "content-type": "application/json" },
    });
    expect(reject.status()).toBe(403);
    const rejectBody = (await reject.json()) as { code: string };
    expect(rejectBody.code).toBe("not_group_admin");

    await ctxOp.close();
    await ctxMember.close();
  });

  test("admin changes the contribution policy and the choice persists", async ({ browser }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);

    const create = await context.request.post("/api/v1/g", {
      data: { name: "Policy group" },
      headers: { "content-type": "application/json" },
    });
    const { id: groupId } = (await create.json()) as { id: string };
    const trackRes = await context.request.post(`/api/v1/g/${groupId}/tracks`, {
      data: { name: "Policy track" },
      headers: { "content-type": "application/json" },
    });
    const { id: trackId } = (await trackRes.json()) as { id: string };

    const page = await context.newPage();
    await page.goto(`/g/${groupId}/t/${trackId}`);
    await page.getByRole("button", { name: /Track settings/i }).click();
    const dialog = page.getByRole("dialog", { name: /Track settings/i });

    // Default is "direct"; flip to "required_review", commit via Save, and
    // confirm the selection round-trips after a reload.
    await dialog.getByRole("radio", { name: /Required review/i }).check();
    await dialog.getByRole("button", { name: /Save changes/i }).click();
    await expect(page.getByText(/Track updated/i)).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: /Track settings/i }).click();
    const dialogAgain = page.getByRole("dialog", { name: /Track settings/i });
    await expect(dialogAgain.getByRole("radio", { name: /Required review/i })).toBeChecked();

    await context.close();
  });
});
