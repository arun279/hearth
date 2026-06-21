import { expect, test } from "@playwright/test";
import { attachSession, resetInstanceState, seedGroupWithTrack, seedOperator } from "./auth.ts";

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
    const { groupId, trackId } = await seedGroupWithTrack(context, {
      groupName: "Tuesday Night Learners",
      trackName: "Beginner Spanish",
      description: "Tuesday practice.",
    });

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

    // On the LAST Part the footer shows a live "Back to track" closure link
    // alongside a live "Mark complete" toggle — the link navigates without
    // claiming completion; the toggle is the honest completion action. There
    // are now two "Back to track" links on this Part: the persistent header
    // one and the footer closure one; on a non-final Part only the header
    // one exists.
    await expect(page.getByRole("link", { name: /Back to track/i })).toHaveCount(2);

    // The track creator is auto-enrolled as a facilitator (a current
    // enrollment), so they may author honor-system completion. The
    // mark-complete toggle is enabled on every Part regardless of `minWords`.
    await expect(page.getByRole("button", { name: /^Mark complete$/i })).toBeEnabled();
    await page.getByRole("button", { name: /^Previous/i }).click();
    await expect(page.getByText(/Part 1 of 2/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Back to track/i })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^Mark complete$/i })).toBeEnabled();
  });

  test("player route returns 404 (not 403) for a non-existent activity id", async ({ browser }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    const { groupId, trackId } = await seedGroupWithTrack(context, {
      groupName: "Probing Group",
      trackName: "Probing Track",
    });

    // The route itself loads and the React Query fetch fails on the
    // bad id. On a 404 specifically (permanent — activity missing /
    // audience exclusion / post-close hidden), the Activity Player
    // renders a neutral "isn't available" callout with no retry
    // button — retry on a 404 recovers nothing. The recovery path is
    // the persistent header "Back to track" link on `ActivityShell`,
    // not an inline duplicate. (5xx still gets the danger callout +
    // retry.)
    await page.goto(`/g/${groupId}/t/${trackId}/a/a_does_not_exist`);
    await expect(page.getByText(/This activity isn't available/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Back to track/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Try again/i })).toBeHidden();
  });

  test("focus mode keeps global nav reachable at 390px and shows an orientation breadcrumb", async ({
    browser,
  }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    const { groupId, trackId } = await seedGroupWithTrack(context, {
      groupName: "Tuesday Night Learners",
      trackName: "Beginner Spanish",
    });
    const activityRes = await context.request.post(`/api/v1/tracks/${trackId}/activities`, {
      data: {
        trackId,
        title: "Greetings & introductions",
        parts: [{ kind: "write_reflection", id: "p_reflect", prompt: "Your favorite phrase?" }],
        flow: { prereqs: [], displayOrder: ["p_reflect"] },
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

    // The orientation breadcrumb (desktop strip) shows the parent track so the
    // deepest screen still says where it sits, distinct from the standing
    // "Back to track" focus-exit.
    await page.goto(`/g/${groupId}/t/${trackId}/a/${activityId}`);
    const breadcrumb = page.getByRole("navigation", { name: /Breadcrumb/i });
    await expect(breadcrumb.getByRole("link", { name: /Beginner Spanish/i })).toBeVisible();
    await expect(breadcrumb.getByRole("link", { name: /Your groups/i })).toBeVisible();

    // The 768–1023 tablet band is the gap the hamburger guards: the desktop
    // Part rail is `lg:flex` (visible only ≥1024), so below 1024 the rail is
    // absent and the hamburger is the sole reach into global nav. Pin the band
    // explicitly — the default project viewport is ≥1024 (rail shown, hamburger
    // hidden) and the only other assertion is at 390px (hamburger shown either
    // way), so without this a regression of the hamburger to `md:hidden` (gone
    // ≥768) would leave the whole suite green. The rail is the first
    // `Activity Parts` nav (DOM order: FlowSidebar before PartTabBar).
    await page.setViewportSize({ width: 900, height: 760 });
    await expect(page.getByRole("button", { name: /Open navigation/i })).toBeVisible();
    await expect(page.getByRole("navigation", { name: /Activity Parts/i }).first()).toBeHidden();

    // At 390px the hamburger opens the nav Drawer so the global nav (the
    // wordmark home link, group/admin/account) is reachable from the focus-mode
    // island rather than being a one-way dead end.
    await page.setViewportSize({ width: 390, height: 760 });
    await page.getByRole("button", { name: /Open navigation/i }).click();
    const drawer = page.getByRole("dialog", { name: /navigation/i });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link", { name: /Hearth — back to your groups/i })).toBeVisible();

    await context.close();
  });
});
