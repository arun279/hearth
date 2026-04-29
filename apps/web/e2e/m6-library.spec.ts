import { expect, test } from "@playwright/test";
import { attachSession, resetInstanceState, seedOperator } from "./auth.ts";

const OPERATOR = {
  userId: "u_e2e_op_m6",
  email: "operator-m6@e2e.example.com",
  name: "M6 Operator",
};

test.describe("M6 — Library page", () => {
  test.beforeEach(() => {
    resetInstanceState();
  });

  test("renders empty state, then surfaces an item created via the API", async ({ browser }) => {
    const op = await seedOperator(OPERATOR);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    // 1. Operator stands up a group via the API, then visits the library page.
    const create = await context.request.post("/api/v1/g", {
      data: { name: "Tuesday Night Learners" },
      headers: { "content-type": "application/json" },
    });
    expect(create.status()).toBe(201);
    const { id: groupId } = (await create.json()) as { id: string };

    await page.goto(`/g/${groupId}/library`);
    await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: /Breadcrumb/i })).toContainText(
      "Tuesday Night Learners",
    );
    await expect(page.getByText(/No library items yet/i)).toBeVisible();
    // Member-with-create-cap sees the upload affordance.
    await expect(page.getByRole("button", { name: /Upload your first item/i })).toBeVisible();

    // 2. Open the upload dialog and verify the form is wired.
    await page.getByRole("button", { name: /Upload your first item/i }).click();
    const uploadDialog = page.getByRole("dialog", { name: /Upload to Library/i });
    await expect(uploadDialog).toBeVisible();
    await expect(uploadDialog.getByText(/Drag a file here/i)).toBeVisible();
    await expect(uploadDialog.getByRole("button", { name: /^Upload$/i })).toBeDisabled();
    // Cancel returns to the empty state.
    await uploadDialog.getByRole("button", { name: /^Cancel$/i }).click();
    await expect(uploadDialog).toBeHidden();
  });

  // The full upload → finalize → revision → retire path crosses the
  // SPA → Worker → R2-stub boundary three times; the default 30 s
  // budget is tight even on warm runs, and a cold compile of the dev
  // server pushes it over. 90 s gives the canonical happy path
  // breathing room without papering over a real regression — a
  // genuine hang still trips the timeout.
  test("uploads a file end-to-end via the dev R2 proxy, then retires it", async ({ browser }) => {
    test.setTimeout(90_000);
    // Walks the canonical upload→revision→retire path the M6 PRD
    // called out. Possible because the dev R2 proxy makes the full
    // request → R2 PUT → finalize chain reachable from a browser
    // context — without the proxy this test would have to mock the
    // PUT step, which is exactly the structural gap that let the
    // pipeline ship locally-broken in the first place.
    const op = await seedOperator(OPERATOR);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    const create = await context.request.post("/api/v1/g", {
      data: { name: "End-to-end Upload" },
      headers: { "content-type": "application/json" },
    });
    const { id: groupId } = (await create.json()) as { id: string };

    await page.goto(`/g/${groupId}/library`);
    await page.getByRole("button", { name: /Upload your first item/i }).click();
    const dialog = page.getByRole("dialog", { name: /Upload to Library/i });
    await expect(dialog).toBeVisible();

    // Pick a file via the hidden <input type="file"> the dropzone wires.
    // `.md` filenames anywhere in committed source are checked against
    // the doc index by `scripts/check-conventions.mjs`, so test
    // fixtures use `.txt` to stay clear of that scan.
    const buffer = Buffer.from("Hello from the e2e upload flow.\n", "utf-8");
    await dialog
      .locator('input[type="file"]')
      .setInputFiles({ name: "primer.txt", mimeType: "text/plain", buffer });
    await dialog.getByRole("textbox", { name: /Title/i }).fill("Primer — e2e");
    await dialog.getByRole("textbox", { name: /Tags/i }).fill("spanish, beginner");
    await dialog.getByRole("button", { name: /^Upload$/i }).click();

    // Toast confirms; dialog closes; row appears in the list.
    await expect(page.getByText(/Library item uploaded\./i)).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: /Open Primer — e2e/i })).toBeVisible();

    // Open detail; verify revision r1 is current.
    await page.getByRole("button", { name: /Open Primer — e2e/i }).click();
    const detail = page.getByRole("dialog", { name: "Primer — e2e" });
    await expect(detail).toBeVisible();
    await expect(detail.getByText(/^r1$/)).toBeVisible();
    await expect(detail.getByText(/^current$/i).first()).toBeVisible();

    // Upload a revision via the same dialog, in revision-mode.
    await detail.getByRole("button", { name: /Upload new revision/i }).click();
    const revDialog = page.getByRole("dialog", { name: /Upload new revision/i });
    await expect(revDialog).toBeVisible();
    await revDialog.locator('input[type="file"]').setInputFiles({
      name: "primer-v2.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("v2 — clarified greetings section\n", "utf-8"),
    });
    await revDialog.getByRole("button", { name: /^Upload$/i }).click();
    await expect(page.getByText(/New revision uploaded\./i)).toBeVisible();
    // The revision dialog closes; the detail stays open and the
    // revisions list refetches with r2 at the top.
    await expect(revDialog).toBeHidden();
    await expect(detail).toBeVisible();
    await expect(detail.getByText(/^r2$/)).toBeVisible();

    // Retire — type-to-confirm gate.
    await detail.getByRole("button", { name: /^Retire$/i }).click();
    const retire = page.getByRole("dialog", { name: /Retire this item\?/i });
    await expect(retire).toBeVisible();
    const confirmBtn = retire.getByRole("button", { name: /^Retire$/i });
    await expect(confirmBtn).toBeDisabled();
    await retire.getByRole("textbox").fill("retire");
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();
    await expect(page.getByText(/Item retired\./i)).toBeVisible();

    // Library list shows the retired badge; the floating Retire / Upload
    // affordances are gone from the detail header now that the item is
    // soft-stopped.
    await expect(page.getByRole("button", { name: /Open Primer — e2e/i })).toContainText(
      /retired/i,
    );
  });

  test("renders the breadcrumb and routes back to the group", async ({ browser }) => {
    const op = await seedOperator(OPERATOR);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    const create = await context.request.post("/api/v1/g", {
      data: { name: "Quiet Reading Group" },
      headers: { "content-type": "application/json" },
    });
    const { id: groupId } = (await create.json()) as { id: string };

    await page.goto(`/g/${groupId}/library`);
    const breadcrumb = page.getByRole("navigation", { name: /Breadcrumb/i });
    await expect(breadcrumb).toContainText("Library");
    await breadcrumb.getByRole("link", { name: "Quiet Reading Group" }).click();
    await expect(page).toHaveURL(`/g/${groupId}`);
    await expect(page.getByRole("heading", { name: "Quiet Reading Group" })).toBeVisible();
  });
});
