/**
 * Captures the M2 screens (home picker, group home, group settings, mobile)
 * for the /design-review skill. Mints a fresh authenticated session via
 * `pnpm local-session` so this script is self-sufficient — no env vars,
 * no manual cookie copy-paste between sessions.
 *
 * Usage:
 *   node apps/web/design-review.mjs <out-dir>
 *
 * Each run resets the design-review user's groups so the empty-home
 * baseline (screenshot 01) is reliable across re-runs.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const REVIEW_EMAIL = "design-review@local.dev";

const OUT = process.argv[2];
if (!OUT) {
  console.error("Usage: node apps/web/design-review.mjs <out-dir>");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

function mintCookie() {
  // --reset drops any groups left over from a prior run so screenshot 01
  // shows the operator's empty home, not whatever the previous run created.
  // --seed is idempotent (INSERT OR IGNORE) so passing both each time is fine.
  const res = spawnSync(
    "pnpm",
    ["-s", "local-session", "--reset", "--seed", "--cookie-only", "--email", REVIEW_EMAIL],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (res.status !== 0) {
    console.error("local-session failed:", res.stderr || res.stdout);
    process.exit(res.status ?? 1);
  }
  return res.stdout.trim();
}

const COOKIE = mintCookie();
const HOST = "http://localhost:5173";

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: COOKIE,
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  const page = await context.newPage();
  const shot = async (name) => {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`saved ${file}`);
  };
  const fullshot = async (name) => {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`saved ${file}`);
  };

  await page.goto(`${HOST}/`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await fullshot("01-home-picker-empty");

  const create1 = await context.request.post(`${HOST}/api/v1/g`, {
    data: { name: "Tuesday Night Learners", description: "Small group, patient pace." },
    headers: { "content-type": "application/json" },
  });
  console.log("create1 status:", create1.status());

  const create2 = await context.request.post(`${HOST}/api/v1/g`, {
    data: { name: "Borges Reading Club", description: "A small group reading Borges." },
    headers: { "content-type": "application/json" },
  });
  console.log("create2 status:", create2.status());

  await page.goto(`${HOST}/`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await fullshot("02-home-picker-multi-group");

  const firstCard = page.getByRole("list", { name: "Your Study Groups" }).getByRole("link").first();
  await firstCard.click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await fullshot("03-group-home-default");

  const sidebar = page.getByRole("complementary");
  const inactive = sidebar
    .getByRole("navigation", { name: "Your groups" })
    .getByRole("link")
    .nth(1);
  try {
    await inactive.hover();
    await page.waitForTimeout(150);
    await shot("04-sidebar-hover-inactive-group");
  } catch (e) {
    console.log("no second sidebar group to hover:", e.message);
  }

  await page.getByRole("button", { name: /Group settings/i }).click();
  await page.waitForTimeout(400);
  await shot("05-group-settings-dialog");

  const archiveBtn = page.getByRole("button", { name: /Archive group/i });
  await archiveBtn.focus();
  await page.waitForTimeout(150);
  await shot("06-group-settings-danger-zone-focus");

  await archiveBtn.click();
  await page.waitForTimeout(300);
  await shot("07-archive-confirm-dialog");

  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(200);

  await page.getByRole("button", { name: /^Close$/ }).click();
  await page.waitForTimeout(200);

  await page.keyboard.press("Tab");
  await page.waitForTimeout(120);
  await shot("08-keyboard-focus-1");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(120);
  await shot("09-keyboard-focus-2");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await fullshot("10-group-home-mobile");

  await page.goto(`${HOST}/`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await fullshot("11-home-picker-mobile");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${HOST}/`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Create Study Group/i }).click();
  await page.waitForTimeout(300);
  await shot("12-create-group-dialog-empty");

  await page.getByRole("button", { name: "Create Study Group" }).nth(1).click();
  await page.waitForTimeout(200);
  await shot("13-create-group-validation");

  console.log("done");
} finally {
  await browser.close();
}
