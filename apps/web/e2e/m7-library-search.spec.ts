import { expect, test } from "@playwright/test";
import { attachSession, resetInstanceState, seedOperator } from "./auth.ts";

const OPERATOR = {
  userId: "u_e2e_op_m7",
  email: "operator-m7@e2e.example.com",
  name: "M7 Operator",
};

test.describe("M7 — Library search", () => {
  test.beforeEach(() => {
    resetInstanceState();
  });

  test("debounces typing, narrows results to matches, and tag values are addressable", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const op = await seedOperator(OPERATOR);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    const create = await context.request.post("/api/v1/g", {
      data: { name: "Search Cohort" },
      headers: { "content-type": "application/json" },
    });
    expect(create.status()).toBe(201);
    const { id: groupId } = (await create.json()) as { id: string };

    await page.goto(`/g/${groupId}/library`);
    await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();

    // Upload first item: Spanish-tagged primer.
    await page.getByRole("button", { name: /Upload your first item/i }).click();
    const firstDialog = page.getByRole("dialog", { name: /Upload to Library/i });
    await firstDialog.locator('input[type="file"]').setInputFiles({
      name: "spanish-primer.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Spanish primer\n", "utf-8"),
    });
    await firstDialog.getByRole("textbox", { name: /Title/i }).fill("Beginner Spanish primer");
    await firstDialog.getByRole("textbox", { name: /Tags/i }).fill("spanish, primer");
    await firstDialog.getByRole("button", { name: /^Upload$/i }).click();
    await expect(page.getByText(/Library item uploaded\./i)).toBeVisible();
    await expect(firstDialog).toBeHidden();

    // Upload second item: French-tagged handout.
    await page.getByRole("button", { name: /^Upload$/i }).click();
    const secondDialog = page.getByRole("dialog", { name: /Upload to Library/i });
    await secondDialog.locator('input[type="file"]').setInputFiles({
      name: "french-handout.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("French handout\n", "utf-8"),
    });
    await secondDialog.getByRole("textbox", { name: /Title/i }).fill("Intermediate French handout");
    await secondDialog.getByRole("textbox", { name: /Tags/i }).fill("french, grammar");
    await secondDialog.getByRole("button", { name: /^Upload$/i }).click();
    await expect(page.getByText(/Library item uploaded\./i).last()).toBeVisible();
    await expect(secondDialog).toBeHidden();

    // Both items render in the unfiltered grid.
    await expect(page.getByRole("button", { name: /Open Beginner Spanish primer/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Open Intermediate French handout/i }),
    ).toBeVisible();

    // Title-match: typing "spanish" hides the French item after the debounce.
    const searchInput = page.getByRole("searchbox", { name: /Search library/i });
    await expect(searchInput).toBeVisible();
    await searchInput.fill("spanish");
    await expect(page.getByRole("button", { name: /Open Beginner Spanish primer/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Open Intermediate French handout/i }),
    ).toBeHidden();

    // Tag-match: typing "grammar" surfaces the French item by its tag.
    await searchInput.fill("grammar");
    await expect(
      page.getByRole("button", { name: /Open Intermediate French handout/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Open Beginner Spanish primer/i })).toBeHidden();

    // No-match: typing nonsense renders the no-results empty state.
    await searchInput.fill("zzzzqqqq");
    await expect(page.getByText(/No matching items/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Open Beginner Spanish primer/i })).toBeHidden();

    // Clear: the EmptyState's "Clear search" action restores the unfiltered grid
    // (matching by role + visible text disambiguates from the icon-button at the
    // input's right edge, which carries the same accessible name by design).
    await page.getByRole("button", { name: "Clear search", exact: true }).last().click();
    await expect(searchInput).toHaveValue("");
    await expect(page.getByRole("button", { name: /Open Beginner Spanish primer/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Open Intermediate French handout/i }),
    ).toBeVisible();

    // Below-minimum-length: a single character keeps the unfiltered grid.
    await searchInput.fill("s");
    await expect(page.getByRole("button", { name: /Open Beginner Spanish primer/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Open Intermediate French handout/i }),
    ).toBeVisible();
  });
});
