import { expect, type Page, test } from "@playwright/test";
import { attachSession, resetInstanceState, seedOperator } from "./auth.ts";

const BOOTSTRAP_USER = {
  userId: "u_e2e_op_overflow",
  email: "overflow@e2e.example.com",
  name: "Overflow Op",
};

const PHONE_VIEWPORT = { width: 375, height: 800 } as const;

/**
 * Returns interactive controls + headings whose content overflows their
 * box at the current viewport. Runs in-page so it sees real layout, not
 * fixture-mocked dimensions.
 */
async function findOverflowingControls(page: Page) {
  return page.evaluate(() => {
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, [role="button"], a, h1, h2, h3, [role="tab"]',
      ),
    );
    const overflowing: Array<{
      tag: string;
      text: string;
      scrollW: number;
      clientW: number;
      scrollH: number;
      clientH: number;
    }> = [];
    for (const el of targets) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const styles = window.getComputedStyle(el);

      // Visually-hidden / sr-only utilities (Tailwind v4's
      // `clip-path: inset(50%)`, Bootstrap, WordPress's
      // `.screen-reader-text`) all converge on a 1×1 absolutely-positioned
      // box with `overflow: hidden`. The 1×1 box's scrollWidth always
      // exceeds clientWidth by design — that's the contract.
      const isSrOnly = rect.width <= 1 && rect.height <= 1 && styles.clipPath !== "none";
      if (isSrOnly) continue;

      // Legitimate scroll containers (lists, textareas) overflow on purpose.
      if (styles.overflowX === "auto" || styles.overflowX === "scroll") continue;
      if (styles.overflowY === "auto" || styles.overflowY === "scroll") continue;

      // `scrollWidth` / `clientWidth` are integer-rounded per CSSOM-View,
      // while underlying layout is fractional. Asymmetric rounding at
      // DPR > 1 produces a 1-pixel ghost gap with no real overflow; bigger
      // overflows (a wrapped label adding +14px height) clear the slop.
      const overflowsX = el.scrollWidth > el.clientWidth + 1;
      const overflowsY = el.scrollHeight > el.clientHeight + 1;
      if (!overflowsX && !overflowsY) continue;
      overflowing.push({
        tag: el.tagName,
        text: el.innerText.replace(/\s+/g, " ").trim().slice(0, 80),
        scrollW: el.scrollWidth,
        clientW: el.clientWidth,
        scrollH: el.scrollHeight,
        clientH: el.clientHeight,
      });
    }
    return overflowing;
  });
}

async function expectNoOverflow(page: Page, where: string) {
  const overflowing = await findOverflowingControls(page);
  expect(
    overflowing,
    `${where} — controls/headings overflow their box at 375px:\n${JSON.stringify(
      overflowing,
      null,
      2,
    )}`,
  ).toEqual([]);
}

/**
 * Detect rows where the identity content (display-name span / heading)
 * has been crushed to zero width by the row's action buttons stealing
 * the available horizontal budget. Catches the failure mode where a
 * sighted touch user sees only action buttons next to an empty space
 * and can't tell which row they're about to mutate.
 *
 * Scope: any `<li>` that contains at least one interactive control
 * (button / role=button / link). Within those, every non-empty,
 * non-aria-hidden text span is required to render with `boundingRect.width > 0`.
 * Runs in-page so it sees real layout.
 */
async function findCrushedRowIdentities(page: Page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLLIElement>("li"));
    const crushed: Array<{ row: string; text: string; selector: string }> = [];
    for (const row of rows) {
      // `offsetParent === null` is the standard "not in the rendered
      // layout" predicate — covers `display: none` ancestors (responsive
      // sidebars hidden under sm) and `position: fixed` invisibles.
      // Hidden rows aren't user-visible regressions; only skip them
      // here, never lean on visibility for the check itself.
      if (row.offsetParent === null) continue;
      const rowRect = row.getBoundingClientRect();
      if (rowRect.width === 0 || rowRect.height === 0) continue;

      const interactive = row.querySelectorAll('button, [role="button"], a[href]');
      if (interactive.length === 0) continue;

      const candidates = row.querySelectorAll<HTMLElement>(
        'span:not([aria-hidden="true"]), h1, h2, h3, h4',
      );
      for (const el of candidates) {
        const text = (el.textContent ?? "").trim();
        if (text.length === 0) continue;
        // Visually-hidden / sr-only utilities collapse via clip-path; skip.
        const styles = window.getComputedStyle(el);
        if (styles.clipPath !== "none") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width >= 1) continue;
        const list = row.parentElement?.getAttribute("aria-label") ?? "";
        crushed.push({
          row: list,
          text: text.slice(0, 60),
          selector: el.tagName.toLowerCase(),
        });
      }
    }
    return crushed;
  });
}

async function expectNoCrushedIdentities(page: Page, where: string) {
  const crushed = await findCrushedRowIdentities(page);
  expect(
    crushed,
    `${where} — list rows have crushed identity content at 375px (display-name shrunk to 0 width by adjacent actions):\n${JSON.stringify(
      crushed,
      null,
      2,
    )}`,
  ).toEqual([]);
}

test.describe("Mobile (375px) overflow regression guard", () => {
  test.beforeEach(() => {
    resetInstanceState();
  });

  test("home, group home, settings, dialogs, drawer, admin — no overflowing controls", async ({
    browser,
  }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext({ viewport: PHONE_VIEWPORT });
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    await page.goto("/");
    await expectNoOverflow(page, "/ (empty)");

    const create = async (name: string) => {
      const res = await context.request.post("/api/v1/g", {
        data: { name },
        headers: { "content-type": "application/json" },
      });
      expect(res.status()).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };
    const longId = await create("A really long Study Group name to stress the layout");
    await create("Tuesday Night Learners");

    await page.goto("/");
    await expectNoOverflow(page, "/ (populated)");

    await page.goto(`/g/${longId}`);
    await expect(page.getByRole("heading", { name: /A really long Study Group/ })).toBeVisible();
    await expectNoOverflow(page, "/g/:id (active, long name)");

    await page.getByRole("button", { name: /Group settings/i }).click();
    await expect(page.getByRole("dialog", { name: /Group settings/i })).toBeVisible();
    await expectNoOverflow(page, "Group settings dialog");

    await page.getByRole("button", { name: /Archive group/i }).click();
    await expect(page.getByRole("dialog", { name: /Archive this group/i })).toBeVisible();
    await expectNoOverflow(page, "Archive confirm (stacked)");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /Open navigation/i }).click();
    await expect(page.getByRole("dialog", { name: /navigation/i })).toBeVisible();
    await expectNoOverflow(page, "Mobile drawer");
    await page.keyboard.press("Escape");

    await page.goto("/admin/instance");
    await page.getByRole("tab", { name: /Operators/i }).click();
    await expect(page.getByRole("button", { name: /Grant operator/i })).toBeVisible();
    await expectNoOverflow(page, "/admin/instance — Operators tab");

    await page.getByRole("tab", { name: /Approved emails/i }).click();
    await expectNoOverflow(page, "/admin/instance — Approved emails tab");

    await page.getByRole("tab", { name: /Settings/i }).click();
    await expectNoOverflow(page, "/admin/instance — Settings tab");

    // Track People page — admin viewing a roster with row-level Promote /
    // Demote / Remove actions. The previous failure mode was the action
    // cluster crushing the display-name span to zero width and clipping
    // the role pill at 375px; both are now caught by
    // expectNoCrushedIdentities and expectNoOverflow respectively.
    const trackHostId = await create("Tuesday Crew");
    const trackRes = await context.request.post(`/api/v1/g/${trackHostId}/tracks`, {
      data: { name: "Beginner Spanish" },
      headers: { "content-type": "application/json" },
    });
    expect(trackRes.status()).toBe(201);
    const trackId = ((await trackRes.json()) as { id: string }).id;
    await page.goto(`/g/${trackHostId}/t/${trackId}/people`);
    await expect(page.getByRole("heading", { name: /^People$/i })).toBeVisible();
    await expectNoOverflow(page, "/g/:id/t/:id/people");
    await expectNoCrushedIdentities(page, "/g/:id/t/:id/people");

    await context.close();
  });
});
