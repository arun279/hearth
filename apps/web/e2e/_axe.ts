import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Run axe-core against the current page state and assert there are no
 * violations of WCAG 2.0/2.1 A or AA. The catch-all `wcag2a / wcag2aa /
 * wcag21a / wcag21aa` tag set excludes axe's `best-practice` and
 * `experimental` buckets — those generate the bulk of axe's
 * false-positive noise; the WCAG-tagged rules have axe-team's
 * documented zero-FP target.
 *
 * Per @axe-core/playwright issue #952, animations not yet settled at
 * scan time can produce flaky color-contrast results. Wait for any
 * page-level animations to finish before invoking the analyzer; on
 * surfaces with no animation this is a no-op.
 */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      Array.from(document.body.getAnimations({ subtree: true })).map((a) => a.finished),
    ).catch(() => {
      // Animations API throws on cancelled animations during navigation;
      // those don't affect contrast scanning, swallow and proceed.
    }),
  );
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    result.violations,
    `axe-core found ${result.violations.length} WCAG violation(s):\n${result.violations
      .map((v) => `  - [${v.id}] ${v.help} (${v.impact}) — ${v.helpUrl}`)
      .join("\n")}`,
  ).toEqual([]);
}
