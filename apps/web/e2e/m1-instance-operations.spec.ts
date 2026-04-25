import { expect, test } from "@playwright/test";
import { attachSession, demoteToMember, resetInstanceState, seedOperator } from "./auth.ts";

const BOOTSTRAP_USER = {
  userId: "u_e2e_op_bootstrap",
  email: "bootstrap@e2e.example.com",
  name: "Bootstrap Operator",
};

test.describe("M1 — Instance & operator basics", () => {
  test.beforeEach(() => {
    resetInstanceState();
  });

  test("operator can rename the instance and the sidebar reflects it", async ({ browser }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    await page.goto("/admin/instance");
    await expect(page.getByRole("heading", { name: "Instance settings" })).toBeVisible();

    const nameInput = page.getByRole("textbox", { name: /Instance name/i });
    await expect(nameInput).toHaveValue("Hearth");
    await nameInput.fill("Tuesday Night Learners");
    await page.getByRole("button", { name: "Save changes" }).click();

    // Toast confirms; query invalidates → sidebar pill updates without reload.
    await expect(page.getByText(/Instance renamed/i)).toBeVisible();
    await expect(page.locator("aside").getByText("Tuesday Night Learners").first()).toBeVisible();

    await context.close();
  });

  test("operator can add and remove an approved email", async ({ browser }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    await page.goto("/admin/instance?tab=emails");
    await expect(page.getByRole("tab", { name: "Approved emails", selected: true })).toBeVisible();

    // Add path
    const addEmail = "guest@e2e.example.com";
    await page.getByRole("textbox", { name: /^Email$/i }).fill(addEmail);
    await page.getByRole("button", { name: /^Add email$/i }).click();
    await expect(page.getByText(/Email approved/i)).toBeVisible();

    const list = page.getByRole("list", { name: "Approved emails" });
    await expect(list.getByText(addEmail)).toBeVisible();

    // Remove path — destructive confirmation explains the session cascade.
    await page.getByRole("button", { name: `Remove ${addEmail}` }).click();
    const confirmDialog = page.getByRole("dialog", { name: /Remove approved email/i });
    await expect(confirmDialog).toBeVisible();
    await expect(
      confirmDialog.getByText(/will sign out anyone currently signed in with that email/i),
    ).toBeVisible();
    await confirmDialog.getByRole("button", { name: /^Remove email$/i }).click();
    await expect(list.getByText(addEmail)).toBeHidden();

    await context.close();
  });

  test("solo operator cannot revoke themselves (button disabled with tooltip)", async ({
    browser,
  }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    await page.goto("/admin/instance?tab=operators");
    const revokeButton = page
      .getByRole("listitem")
      .filter({ hasText: op.userId })
      .getByRole("button");
    await expect(revokeButton).toBeDisabled();
    // Both reasons are valid — self AND only operator. The UI prefers the
    // self-explanation; either label is acceptable.
    const label = (await revokeButton.getAttribute("aria-label")) ?? "";
    expect(label).toMatch(/(can't revoke your own|Grant another operator)/i);

    await context.close();
  });

  test("granting an unknown email surfaces the user_not_found inline hint", async ({ browser }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    await page.goto("/admin/instance?tab=operators");
    await page
      .getByRole("button", { name: /Grant operator/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog", { name: /Grant operator role/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: /^Email$/i }).fill("nobody@e2e.example.com");
    await dialog.getByRole("button", { name: /Grant operator/i }).click();

    await expect(dialog.getByText(/No signed-in user has this email yet/i)).toBeVisible();
    // Dialog stays open so the operator can correct.
    await expect(dialog).toBeVisible();

    await context.close();
  });

  test("operator A grants B then revokes B back to a single operator", async ({ browser }) => {
    const opA = await seedOperator(BOOTSTRAP_USER);
    const opB = await seedOperator({
      userId: "u_e2e_op_second",
      email: "second@e2e.example.com",
      name: "Second Operator",
    });

    const ctxA = await browser.newContext();
    await attachSession(ctxA, opA.cookie);
    const pageA = await ctxA.newPage();

    // Both operators show up. Revoking B drops the count to 1 — the row
    // disappears from the current-operators list; A is now alone.
    await pageA.goto("/admin/instance?tab=operators");
    await expect(
      pageA.getByRole("list", { name: /Current instance operators/i }).getByText(opB.userId),
    ).toBeVisible();

    const rowB = pageA.getByRole("listitem").filter({ hasText: opB.userId });
    await rowB.getByRole("button").click();
    const confirm = pageA.getByRole("dialog", { name: /Revoke operator role/i });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: /^Revoke$/i }).click();
    await expect(pageA.getByText(/Operator revoked/i)).toBeVisible();

    // Server-side guard: trying to revoke yourself when you're the only
    // operator returns 403 cannot_revoke_self. (The would_orphan_operator
    // 422 path is exercised by adapter integration tests under concurrent
    // race conditions where the UI's cannot_revoke_self gate has already
    // been bypassed.)
    const selfRevoke = await pageA.request.delete(`/api/v1/instance/operators/${opA.userId}`);
    expect(selfRevoke.status()).toBe(403);
    const body = (await selfRevoke.json()) as { code: string; policy?: { code: string } };
    expect(body.policy?.code ?? body.code).toBe("cannot_revoke_self");

    await ctxA.close();
  });

  test("non-operator hitting /admin/instance is redirected to home", async ({ browser }) => {
    // Seed a bootstrap operator first so the instance has an operator (the
    // sign-in CTA differs when needsBootstrap is true). Then seed a plain
    // user with no operator row and try to access /admin/instance.
    await seedOperator(BOOTSTRAP_USER);
    const plain = {
      userId: "u_e2e_member",
      email: "member@e2e.example.com",
      name: "Plain Member",
    };
    // seedOperator creates user + session + operator row. Demote leaves the
    // session valid but flips `isOperator` to false — exercising the SPA's
    // beforeLoad redirect.
    const seeded = await seedOperator(plain);
    demoteToMember(plain.userId);

    const context = await browser.newContext();
    await attachSession(context, seeded.cookie);
    const page = await context.newPage();

    await page.goto("/admin/instance");
    // Redirected to home; the admin route is no longer in the URL.
    await expect(page).toHaveURL(/\/$/);

    await context.close();
  });
});
