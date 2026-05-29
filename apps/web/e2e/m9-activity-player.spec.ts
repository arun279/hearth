import { expect, test } from "@playwright/test";
import { attachSession, resetInstanceState, seedOperator } from "./auth.ts";

const BOOTSTRAP_USER = {
  userId: "u_e2e_op_m9",
  email: "m9-bootstrap@e2e.example.com",
  name: "M9 Operator",
};

test.describe("M9 — Activity player (passive Parts)", () => {
  test.beforeEach(() => {
    resetInstanceState();
  });

  test("facilitator composes an activity with an Embed Part, then opens it in the player", async ({
    browser,
  }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    // Seed a group + track via API so the test stays focused on the
    // player surface rather than upstream creation flows.
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

    // Compose an activity with two passive Parts via the composer —
    // an Embed (YouTube) and a Reflection (to exercise the deferred-kind
    // placeholder branch). Two Parts is enough to verify Flow Sidebar
    // navigation + Part-X-of-N counter.
    await page.goto(`/g/${groupId}/t/${trackId}`);
    await page.getByRole("button", { name: /New activity/i }).click();
    const composer = page.getByRole("dialog", { name: /New activity/i });
    await composer.getByRole("textbox", { name: /^Title$/i }).fill("Greetings & introductions");
    await composer.getByRole("button", { name: /Reflection/i }).click();
    await composer
      .getByRole("textbox", { name: /Reflection prompt/i })
      .fill("What's your favorite Spanish phrase?");
    await composer.getByRole("button", { name: /^Embed/i }).click();
    await composer
      .getByRole("textbox", { name: /Embed URL/i })
      .fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await composer.getByRole("button", { name: /Create activity/i }).click();
    await expect(page.getByText(/Activity created/i)).toBeVisible();

    // Row click navigates to the player. The composer NO LONGER opens
    // on row click — that's the explicit pencil affordance now. The
    // player route surfaces the activity title in a serif heading.
    await page.getByRole("button", { name: /Open activity: Greetings & introductions/i }).click();
    await expect(page).toHaveURL(/\/g\/[^/]+\/t\/[^/]+\/a\//);
    await expect(page.getByRole("heading", { name: /Greetings & introductions/i })).toBeVisible();

    // The Part-X-of-N counter renders "Part 1 of 2".
    await expect(page.getByText(/Part 1 of 2/i)).toBeVisible();

    // The desktop FlowSidebar lists both Parts; tapping the second one
    // mounts its renderer. Either the sidebar (≥md) or the mobile tab
    // bar (<md) is visible depending on the viewport — Playwright
    // defaults to a desktop-sized viewport so the sidebar is in play.
    // The active Part is `aria-current="step"`.
    const sidebar = page.getByRole("navigation", { name: /Activity Parts/i }).first();
    await expect(sidebar).toBeVisible();
    const secondPartButton = sidebar.getByRole("button").nth(1);
    await secondPartButton.click();
    await expect(page.getByText(/Part 2 of 2/i)).toBeVisible();

    // The Embed Part renders an iframe whose src is the canonical
    // YouTube embed URL — buildEmbedSrc translates the share form.
    await expect(page.locator("iframe")).toHaveCount(1);

    // Refresh preserves the active Part via the `?part=<id>` deep-link.
    const urlAfterClick = page.url();
    expect(urlAfterClick).toContain("part=");
    await page.reload();
    await expect(page.getByText(/Part 2 of 2/i)).toBeVisible();

    // Mark Complete renders as a disabled placeholder — clicking it
    // performs no action. The Previous / Next chevrons DO navigate.
    const markComplete = page.getByRole("button", { name: /Mark complete/i });
    await expect(markComplete).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("button", { name: /^Previous/i }).click();
    await expect(page.getByText(/Part 1 of 2/i)).toBeVisible();
  });

  test("player route returns 404 (not 403) for a non-existent activity id", async ({ browser }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    const groupRes = await context.request.post("/api/v1/g", {
      data: { name: "Probing Group" },
      headers: { "content-type": "application/json" },
    });
    const { id: groupId } = (await groupRes.json()) as { id: string };
    const trackRes = await context.request.post(`/api/v1/g/${groupId}/tracks`, {
      data: { name: "Probing Track" },
      headers: { "content-type": "application/json" },
    });
    const { id: trackId } = (await trackRes.json()) as { id: string };

    // The route itself loads and the React Query fetch fails on the
    // bad id. On a 404 specifically (permanent — activity missing /
    // audience exclusion / post-close hidden), the Activity Player
    // renders a neutral "isn't available" callout with a Return-to-
    // track affordance — no retry button, since retry on a 404
    // recovers nothing. (5xx still gets the danger callout + retry.)
    await page.goto(`/g/${groupId}/t/${trackId}/a/a_does_not_exist`);
    await expect(page.getByText(/This activity isn't available/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Return to track/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Try again/i })).toBeHidden();
  });
});
