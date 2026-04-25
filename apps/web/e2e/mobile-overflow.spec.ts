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

    await context.close();
  });
});
