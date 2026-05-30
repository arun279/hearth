import { expect, test } from "@playwright/test";
import { attachSession, resetInstanceState, seedOperator } from "./auth.ts";

const BOOTSTRAP_USER = {
  userId: "u_e2e_op_m10",
  email: "m10-bootstrap@e2e.example.com",
  name: "M10 Operator",
};

test.describe("M10 — Activity player (interactive Parts)", () => {
  test.beforeEach(() => {
    resetInstanceState();
  });

  test("reflection autosaves + visibility persists across reload; quiz grades server-side", async ({
    browser,
  }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    const groupRes = await context.request.post("/api/v1/g", {
      data: { name: "Tuesday Night Learners" },
      headers: { "content-type": "application/json" },
    });
    const { id: groupId } = (await groupRes.json()) as { id: string };

    const trackRes = await context.request.post(`/api/v1/g/${groupId}/tracks`, {
      data: { name: "Beginner Spanish" },
      headers: { "content-type": "application/json" },
    });
    const { id: trackId } = (await trackRes.json()) as { id: string };

    // Seed a reflection + quiz activity directly so the test stays focused
    // on the interactive surfaces rather than the composer's quiz editor.
    const activityRes = await context.request.post(`/api/v1/tracks/${trackId}/activities`, {
      data: {
        trackId,
        title: "Reflect & check",
        parts: [
          {
            kind: "write_reflection",
            id: "p_reflect",
            prompt: "What did you learn today?",
            minWords: 3,
          },
          {
            kind: "quiz",
            id: "p_quiz",
            questions: [
              {
                id: "q1",
                prompt: "What is 2 + 2?",
                shape: { kind: "multiple_choice", options: ["3", "4", "5"], answerKeyIndex: 1 },
                explainAfterAnswer: "Two plus two is four.",
              },
            ],
          },
        ],
        flow: { prereqs: [], displayOrder: ["p_reflect", "p_quiz"] },
        audience: { kind: "everyone_enrolled" },
        completionRule: { kind: "manual_mark" },
        libraryRefs: [],
        prerequisiteActivityIds: [],
        suggestedNextActivityIds: [],
      },
      headers: { "content-type": "application/json" },
    });
    expect(activityRes.status()).toBe(201);
    const { id: activityId } = (await activityRes.json()) as { id: string };

    await page.goto(`/g/${groupId}/t/${trackId}/a/${activityId}`);

    // Part 1 — reflection. Typing autosaves (debounced); the indicator
    // settles on "Saved" with no explicit save button.
    const reflection = page.getByRole("textbox", { name: /Your reflection/i });
    await expect(reflection).toBeVisible();
    await reflection.fill("Numbers in Spanish");
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 5000 });

    // Flip the record-level visibility to "Just me". The radio is controlled
    // by the visibility mutation (async), so click it and verify persistence
    // through the reload below rather than asserting the state flips inline.
    await page.getByRole("radio", { name: /Just me/i }).click();

    // Reload preserves both the saved reflection and the visibility choice.
    await page.reload();
    const reflectionAfter = page.getByRole("textbox", { name: /Your reflection/i });
    await expect(reflectionAfter).toHaveValue("Numbers in Spanish");
    await expect(page.getByRole("radio", { name: /Just me/i })).toBeChecked();

    // Part 2 — quiz. Navigate via the flow nav, answer, submit. Grading is
    // server-side; the correct verdict + the explanation render, and the
    // aggregate calls out the graded count.
    const nav = page.getByRole("navigation", { name: /Activity Parts/i }).first();
    await nav.getByRole("button").nth(1).click();
    await expect(page.getByText(/What is 2 \+ 2\?/i)).toBeVisible();
    await page.getByRole("radio", { name: /^4$/ }).click();
    await page.getByRole("button", { name: /Submit answers/i }).click();
    await expect(page.getByText("Correct", { exact: true })).toBeVisible();
    await expect(page.getByText(/Two plus two is four\./i)).toBeVisible();
    await expect(page.getByText(/1 of 1 graded correct/i)).toBeVisible();
  });
});
