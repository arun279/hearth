import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./_axe.ts";
import { attachSession, resetInstanceState, seedOperator } from "./auth.ts";

const OPERATOR = {
  userId: "u_e2e_a11y",
  email: "operator-a11y@e2e.example.com",
  name: "A11y Operator",
};

/**
 * Catches WCAG violations the @hearth/ui token-pair contrast test
 * cannot see — anything resolved at the rendered DOM level (computed
 * font sizes, semi-transparent overlays, focus states, dynamic
 * content). Token-level checks live in `packages/ui/test/tokens.test.ts`
 * and run inside `pnpm check`; this spec runs inside `pnpm e2e` and
 * complements them.
 *
 * Surfaces covered: home (signed-in landing), group home, library
 * page (M6 cards + M7 search), instance settings (M1). New
 * user-facing routes should land here on first ship; the cost is one
 * `expectNoAxeViolations(page)` call per surface.
 */

test.describe("a11y — WCAG 2.0/2.1 A + AA via axe-core", () => {
  test.beforeEach(() => {
    resetInstanceState();
  });

  test("signed-in home, group home, library, and admin surfaces have no axe violations", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const op = await seedOperator(OPERATOR);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    // Stand up a Study Group via the API so the group/library surfaces
    // have something to render. Empty-state and populated-state both
    // need to be covered, but populated is the higher-density a11y
    // surface — token roles, focus rings, badges all show.
    const create = await context.request.post("/api/v1/g", {
      data: { name: "A11y Cohort" },
      headers: { "content-type": "application/json" },
    });
    expect(create.status()).toBe(201);
    const { id: groupId } = (await create.json()) as { id: string };

    // 1. Home (your-groups)
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);

    // 2. Group home
    await page.goto(`/g/${groupId}`);
    await expect(page.getByRole("heading", { name: /A11y Cohort/i })).toBeVisible();
    await expectNoAxeViolations(page);

    // 3. Library — empty state (no items uploaded)
    await page.goto(`/g/${groupId}/library`);
    await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
    await expectNoAxeViolations(page);

    // 4. Admin — instance settings
    await page.goto("/admin/instance");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
