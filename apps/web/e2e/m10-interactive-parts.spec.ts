import { expect, test } from "@playwright/test";
import { attachSession, resetInstanceState, seedOperator } from "./auth.ts";

const BOOTSTRAP_USER = {
  userId: "u_e2e_op_m10",
  email: "m10-bootstrap@e2e.example.com",
  name: "M10 Operator",
};

// Smart quotes + a non-ASCII accent exercise the JSON round-trip through
// the autosave PUT and the part_progress envelope unchanged.
const REFLECTION = "Me gusta “buenos días.”";

test.describe("M10 — Activity rendering: interactive Parts", () => {
  test.beforeEach(() => {
    resetInstanceState();
  });

  test("facilitator authors a reflection + quiz; participant writes, sets visibility, submits", async ({
    browser,
  }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    // Seed group + track via API. The track creator is auto-enrolled as a
    // facilitator — a current enrollment — so the same account both authors
    // the activity and participates in it (canRecordOwnActivityProgress is
    // role-agnostic: it gates on a current enrollment, not on being a
    // non-facilitator).
    const groupRes = await context.request.post("/api/v1/g", {
      data: { name: "Tuesday Night Learners" },
      headers: { "content-type": "application/json" },
    });
    expect(groupRes.status()).toBe(201);
    const { id: groupId } = (await groupRes.json()) as { id: string };

    const trackRes = await context.request.post(`/api/v1/g/${groupId}/tracks`, {
      data: { name: "Beginner Spanish", description: "Tuesday practice." },
      headers: { "content-type": "application/json" },
    });
    expect(trackRes.status()).toBe(201);
    const { id: trackId } = (await trackRes.json()) as { id: string };

    // --- Compose: a write_reflection Part + a single-question quiz ---
    await page.goto(`/g/${groupId}/t/${trackId}`);
    await page.getByRole("button", { name: /New activity/i }).click();
    const composer = page.getByRole("dialog", { name: /New activity/i });
    await composer.getByRole("textbox", { name: /^Title$/i }).fill("Greetings & introductions");

    await composer.getByRole("button", { name: /Reflection/i }).click();
    await composer
      .getByRole("textbox", { name: /Reflection prompt/i })
      .fill("What's your favorite Spanish phrase so far?");

    // Quiz authoring: one multiple-choice question with a marked answer key
    // and a post-answer explanation. The client never validates the key —
    // the server is authoritative — so a successful round-trip proves the
    // composer serialized the quiz Part shape the domain schema expects.
    await composer.getByRole("button", { name: /^Quiz$/i }).click();
    await composer
      .getByRole("textbox", { name: /Question 1 prompt/i })
      .fill("Which greeting is most formal?");
    await composer.getByRole("textbox", { name: /Question 1 option 1/i }).fill("Buenos días");
    await composer.getByRole("textbox", { name: /Question 1 option 2/i }).fill("Qué onda");
    await composer.getByRole("radio", { name: /Mark option 1 correct/i }).check();
    await composer
      .getByRole("textbox", { name: /^Explanation$/i })
      .fill("“Buenos días” is the formal daytime greeting.");

    await composer.getByRole("button", { name: /Create activity/i }).click();
    await expect(page.getByText(/Activity created/i)).toBeVisible();

    // --- Open in the player ---
    await page.getByRole("button", { name: /Open activity: Greetings & introductions/i }).click();
    await expect(page.getByRole("heading", { name: /Greetings & introductions/i })).toBeVisible();
    await expect(page.getByText(/Part 1 of 2/i)).toBeVisible();

    // --- Reflection: the debounced autosave cycles to "Saved" ---
    const reflection = page.getByRole("textbox", { name: /Your reflection/i });
    await reflection.fill(REFLECTION);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    // --- Visibility: flip the record-level override to "Just me" ---
    // The selector's radios carry a description, so the accessible name is
    // "<label> <description>" — match the label as a substring. The radio is
    // controlled off the server round-trip (it reflects `checked` only after
    // the mutation refetches), so click it rather than `.check()`, which would
    // wait on a `:checked` state that lags the click.
    await page.getByRole("button", { name: /Visibility:/i }).click();
    await page.getByRole("radio", { name: /Just me/i }).click();
    await expect(page.getByRole("button", { name: /Visibility:/i })).toContainText("Just me");

    // --- Reload preserves both the draft and the visibility override ---
    await page.reload();
    await expect(page.getByText(/Part 1 of 2/i)).toBeVisible();
    await expect(page.getByRole("textbox", { name: /Your reflection/i })).toHaveValue(REFLECTION);
    await expect(page.getByRole("button", { name: /Visibility:/i })).toContainText("Just me");

    // --- Quiz: navigate to Part 2, answer correctly, submit ---
    const sidebar = page.getByRole("navigation", { name: /Activity Parts/i }).first();
    await sidebar.getByRole("button").nth(1).click();
    await expect(page.getByText(/Part 2 of 2/i)).toBeVisible();

    await page.getByRole("radio", { name: /Buenos días/i }).check();
    await page.getByRole("button", { name: /^Submit$/i }).click();

    // Server-graded feedback renders from the submit response: the correct
    // verdict, the post-answer explanation, and the 1-of-1 score. The answer
    // key itself never crossed the wire (the /player projection redacts it).
    await expect(page.getByText(/^Correct$/i)).toBeVisible();
    await expect(page.getByText(/formal daytime greeting/i)).toBeVisible();
    await expect(page.getByText(/1 of 1/i)).toBeVisible();
  });
});
