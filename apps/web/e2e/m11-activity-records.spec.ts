import { expect, test } from "@playwright/test";
import { attachSession, resetInstanceState, seedGroupWithTrack, seedOperator } from "./auth.ts";

const BOOTSTRAP_USER = {
  userId: "u_e2e_op_m11",
  email: "m11-bootstrap@e2e.example.com",
  name: "M11 Operator",
};

// A syntactically valid one-page PDF so the read_library_item Part has a real
// item to resolve; the History behaviour under test does not depend on the
// renderer painting it.
const PDF_V1 = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n164\n%%EOF\n",
  "latin1",
);
const PDF_V2 = Buffer.concat([PDF_V1, Buffer.from("\n% v2\n", "latin1")]);

// The picker labels each option `<title> · <kind>`, so select by the option
// whose value matches the item carrying the given title rather than an exact
// label string.
async function pickLibraryItem(
  composer: import("@playwright/test").Locator,
  title: string,
): Promise<void> {
  const select = composer.getByRole("combobox", { name: /Library Item/i });
  const value = await select.locator("option", { hasText: title }).first().getAttribute("value");
  if (!value) throw new Error(`Library Item option for "${title}" not found`);
  await select.selectOption(value);
}

async function uploadReadingItem(
  page: import("@playwright/test").Page,
  groupId: string,
  title: string,
): Promise<void> {
  await page.goto(`/g/${groupId}/library`);
  await page
    .getByRole("button", { name: /Upload your first item|Upload/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: /Upload to Library/i });
  await expect(dialog).toBeVisible();
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: "reading.pdf", mimeType: "application/pdf", buffer: PDF_V1 });
  await dialog.getByRole("textbox", { name: /Title/i }).fill(title);
  await dialog.getByRole("button", { name: /^Upload$/i }).click();
  await expect(page.getByText(/Library item uploaded\./i)).toBeVisible();
  await expect(dialog).toBeHidden();
}

test.describe("M11 — Activity Records, Part Progress & Part History", () => {
  test.beforeEach(() => {
    resetInstanceState();
  });

  test("manual completion auto-transitions the activity under all-parts-complete", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    const { groupId, trackId } = await seedGroupWithTrack(context, {
      groupName: "M11 Learners",
      trackName: "Records & Progress",
      description: "Durable per-participant state.",
    });

    await uploadReadingItem(page, groupId, "Course primer");

    await page.goto(`/g/${groupId}/t/${trackId}`);
    await page.getByRole("button", { name: /New activity/i }).click();
    const composer = page.getByRole("dialog", { name: /New activity/i });
    await composer.getByRole("textbox", { name: /^Title$/i }).fill("Unit 1");

    await composer.getByRole("button", { name: /Reading/i }).click();
    await pickLibraryItem(composer, "Course primer");

    await composer.getByRole("button", { name: /Reflection/i }).click();
    await composer
      .getByRole("textbox", { name: /Reflection prompt/i })
      .fill("What stood out in the primer?");

    await composer
      .getByRole("combobox", { name: /Completion rule/i })
      .selectOption("all_parts_complete");

    await composer.getByRole("button", { name: /Create activity/i }).click();
    await expect(page.getByText(/Activity created/i)).toBeVisible();

    await page.getByRole("button", { name: /Open activity: Unit 1/i }).click();
    await expect(page.getByRole("heading", { name: /^Unit 1$/i })).toBeVisible();
    await expect(page.getByText(/0 of 2 Parts complete/i)).toBeVisible();

    // Mark the reading Part complete.
    await page.getByRole("button", { name: /^Mark this part done$/i }).click();
    await expect(page.getByText(/1 of 2 Parts complete/i)).toBeVisible();

    // Move to the reflection Part and mark it complete — the last Part flips
    // the activity to completed under all_parts_complete.
    const sidebar = page.getByRole("navigation", { name: /Activity Parts/i }).first();
    await sidebar.getByRole("button").nth(1).click();
    await expect(page.getByText(/Part 2 of 2/i)).toBeVisible();
    await page.getByRole("button", { name: /^Mark this part done$/i }).click();
    await expect(page.getByText(/2 of 2 Parts complete/i)).toBeVisible();
    await expect(page.getByText(/All parts complete/i)).toBeVisible();
  });

  test("facilitator reset preserves prior work as Part History", async ({ browser }) => {
    test.setTimeout(90_000);
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    const { groupId, trackId } = await seedGroupWithTrack(context, {
      groupName: "M11 Learners",
      trackName: "Records & Progress",
    });

    await page.goto(`/g/${groupId}/t/${trackId}`);
    await page.getByRole("button", { name: /New activity/i }).click();
    const composer = page.getByRole("dialog", { name: /New activity/i });
    await composer.getByRole("textbox", { name: /^Title$/i }).fill("Reflection unit");
    await composer.getByRole("button", { name: /Reflection/i }).click();
    await composer
      .getByRole("textbox", { name: /Reflection prompt/i })
      .fill("Summarise the session.");
    await composer.getByRole("button", { name: /Create activity/i }).click();
    await expect(page.getByText(/Activity created/i)).toBeVisible();

    await page.getByRole("button", { name: /Open activity: Reflection unit/i }).click();
    await expect(page.getByRole("heading", { name: /^Reflection unit$/i })).toBeVisible();

    // Participant writes — creating durable Part Progress.
    const reflection = page.getByRole("textbox", { name: /Your reflection/i });
    await reflection.fill("My first attempt.");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    // The track creator is enrolled as facilitator, so the same account reaches
    // the roster + reset affordance for its own record.
    await page.getByRole("button", { name: /Participant progress/i }).click();
    const roster = page.getByRole("dialog", { name: /— participants/i });
    await expect(roster).toBeVisible();
    await roster
      .getByRole("button", { name: /Reset progress/i })
      .first()
      .click();

    const confirm = page.getByRole("dialog", { name: /Reset this participant's progress\?/i });
    await expect(confirm).toBeVisible();
    const resetPost = page.waitForResponse(
      (r) => r.url().includes("/reset") && r.request().method() === "POST",
    );
    await confirm.getByRole("button", { name: /Reset progress/i }).click();
    expect((await resetPost).status()).toBe(200);
    await expect(page.getByText(/Reset progress for .+\./i)).toBeVisible();

    // Reopen: the reflection is back to empty, but the prior attempt survives as
    // Part History — surfaced by the activity-level chip and the per-Part chip.
    await page.reload();
    await expect(page.getByRole("textbox", { name: /Your reflection/i })).toHaveValue("");
    await expect(page.getByText(/1 prior attempt preserved/i)).toBeVisible();

    const sidebar = page.getByRole("navigation", { name: /Activity Parts/i }).first();
    const historyChip = sidebar.getByRole("button", { name: /View prior attempts for/i });
    await expect(historyChip).toBeVisible();
    await historyChip.click();
    const drawer = page.getByRole("dialog", { name: /prior attempts|Part History|history/i });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(/My first attempt\./i)).toBeVisible();
  });

  test("a new Library Revision reopens only the affected reading Part", async ({ browser }) => {
    test.setTimeout(120_000);
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    const { groupId, trackId } = await seedGroupWithTrack(context, {
      groupName: "M11 Learners",
      trackName: "Records & Progress",
    });

    await uploadReadingItem(page, groupId, "Living primer");

    await page.goto(`/g/${groupId}/t/${trackId}`);
    await page.getByRole("button", { name: /New activity/i }).click();
    const composer = page.getByRole("dialog", { name: /New activity/i });
    await composer.getByRole("textbox", { name: /^Title$/i }).fill("Living unit");
    await composer.getByRole("button", { name: /Reading/i }).click();
    await pickLibraryItem(composer, "Living primer");
    await composer.getByRole("button", { name: /Reflection/i }).click();
    await composer
      .getByRole("textbox", { name: /Reflection prompt/i })
      .fill("Notes on the primer?");
    await composer.getByRole("button", { name: /Create activity/i }).click();
    await expect(page.getByText(/Activity created/i)).toBeVisible();

    // Participant engages BOTH Parts: marks the reading Part complete (durable
    // progress on the reading Part) and writes a reflection (progress on the
    // non-reading Part). Only the reading Part should reopen on the bump.
    await page.getByRole("button", { name: /Open activity: Living unit/i }).click();
    await expect(page.getByText(/Part 1 of 2/i)).toBeVisible();
    await page.getByRole("button", { name: /^Mark this part done$/i }).click();
    await expect(page.getByText(/1 of 2 Parts complete/i)).toBeVisible();

    const sidebar = page.getByRole("navigation", { name: /Activity Parts/i }).first();
    await sidebar.getByRole("button").nth(1).click();
    await expect(page.getByText(/Part 2 of 2/i)).toBeVisible();
    await page.getByRole("textbox", { name: /Your reflection/i }).fill("Reflection survives.");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    // Publish a new revision of the reading item.
    await page.goto(`/g/${groupId}/library`);
    await page.getByRole("button", { name: /Open Living primer/i }).click();
    const detail = page.getByRole("dialog", { name: "Living primer" });
    await expect(detail).toBeVisible();
    await detail.getByRole("button", { name: /Upload new revision/i }).click();
    const revDialog = page.getByRole("dialog", { name: /Upload new revision/i });
    await revDialog
      .locator('input[type="file"]')
      .setInputFiles({ name: "reading-v2.pdf", mimeType: "application/pdf", buffer: PDF_V2 });
    await revDialog.getByRole("button", { name: /^Upload$/i }).click();
    await expect(page.getByText(/New revision uploaded\./i)).toBeVisible();

    // Back in the player: only the reading Part reopens — it carries the history
    // chip and its completion is reset; the reflection Progress is preserved.
    await page.goto(`/g/${groupId}/t/${trackId}`);
    await page.getByRole("button", { name: /Open activity: Living unit/i }).click();
    await expect(page.getByText(/1 prior attempt preserved/i)).toBeVisible();
    // The reading Part's completion was reopened, so the count is back to 0.
    await expect(page.getByText(/0 of 2 Parts complete/i)).toBeVisible();

    const playerSidebar = page.getByRole("navigation", { name: /Activity Parts/i }).first();
    await expect(
      playerSidebar.getByRole("button", { name: /View prior attempts for/i }),
    ).toHaveCount(1);

    // The reflection Part (untouched by the bump) keeps its progress.
    await playerSidebar.getByRole("button", { name: /Reflection/i }).click();
    await expect(page.getByRole("textbox", { name: /Your reflection/i })).toHaveValue(
      "Reflection survives.",
    );
  });
});
