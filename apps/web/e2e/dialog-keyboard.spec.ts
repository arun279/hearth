import { expect, test } from "@playwright/test";
import { attachSession, resetInstanceState, seedOperator } from "./auth.ts";

const BOOTSTRAP_USER = {
  userId: "u_e2e_op_dialogkbd",
  email: "dialog-kbd@e2e.example.com",
  name: "Dialog Keyboard Op",
};

test.describe("Dialog keyboard contract", () => {
  test.beforeEach(() => {
    resetInstanceState();
  });

  test("ESC closes the mobile drawer (no keyboard trap)", async ({ browser }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    await page.goto("/");
    await page.getByRole("button", { name: /Open navigation/i }).click();

    const drawer = page.getByRole("dialog", { name: /navigation/i });
    await expect(drawer).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    // Focus returns to the trigger so a keyboard user resumes where they were.
    const hamburger = page.getByRole("button", { name: /Open navigation/i });
    await expect(hamburger).toBeFocused();

    await context.close();
  });

  test("ESC routes to the topmost stacked dialog and inerts the parent", async ({ browser }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    const create = await context.request.post("/api/v1/g", {
      data: { name: "Stacked Dialogs Group" },
      headers: { "content-type": "application/json" },
    });
    expect(create.status()).toBe(201);
    const { id } = (await create.json()) as { id: string };

    await page.goto(`/g/${id}`);
    await page.getByRole("button", { name: /Group settings/i }).click();
    const settings = page.getByRole("dialog", { name: /Group settings/i });
    await expect(settings).toBeVisible();

    await settings.getByRole("button", { name: /Archive group/i }).click();
    const confirm = page.getByRole("dialog", { name: /Archive this group/i });
    await expect(confirm).toBeVisible();

    await expect(settings).toHaveAttribute("inert", "");
    await expect(confirm).not.toHaveAttribute("inert", "");

    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
    await expect(settings).toBeVisible();
    await expect(settings).not.toHaveAttribute("inert", "");

    await context.close();
  });

  test("Empty submit on Create dialog stays interactive and never POSTs", async ({ browser }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    const posts: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/v1/g")) posts.push(req.url());
    });

    await page.goto("/");
    await page.getByRole("button", { name: /Create Study Group/i }).click();

    const dialog = page.getByRole("dialog", { name: /Create a Study Group/i });
    await expect(dialog).toBeVisible();

    const submit = dialog.getByRole("button", { name: /^Create Study Group$/i });
    await expect(submit).toBeDisabled();
    await expect(dialog.getByRole("button", { name: /^Cancel$/i })).toBeEnabled();
    expect(posts).toEqual([]);

    // The inline `role="alert"` only renders if the zod resolver populates
    // `form.formState.errors.name` — a resolver/Zod major-version mismatch
    // would silently swallow this error even with the disabled-gate intact.
    const nameInput = dialog.getByRole("textbox", { name: /^Name$/i });
    await nameInput.fill("temp");
    await nameInput.fill("");
    await nameInput.press("Tab");
    await expect(dialog.getByRole("alert")).toContainText(/give your group a name/i);

    await nameInput.fill("Empty Submit Recovery");
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText(/Study Group created/i)).toBeVisible();
    expect(posts).toHaveLength(1);

    await context.close();
  });
});
