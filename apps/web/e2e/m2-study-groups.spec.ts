import { expect, test } from "@playwright/test";
import { attachSession, demoteToMember, resetInstanceState, seedOperator } from "./auth.ts";

const BOOTSTRAP_USER = {
  userId: "u_e2e_op_bootstrap",
  email: "bootstrap@e2e.example.com",
  name: "Bootstrap Operator",
};

test.describe("M2 — Study Group lifecycle", () => {
  test.beforeEach(() => {
    resetInstanceState();
  });

  test("operator creates a Study Group, archives it, then unarchives it", async ({ browser }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    // Empty home: operator-only Create Study Group CTA.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /^Hearth$/ })).toBeVisible();
    await expect(page.getByText(/No Study Groups yet/i)).toBeVisible();

    await page.getByRole("button", { name: /Create Study Group/i }).click();

    const createDialog = page.getByRole("dialog", { name: /Create a Study Group/i });
    await expect(createDialog).toBeVisible();
    await createDialog.getByRole("textbox", { name: /^Name$/i }).fill("Tuesday Night Learners");
    // The Description field exposes its hint via aria-describedby, which
    // browsers fold into the accessible name. Use a substring match to stay
    // robust to that copy.
    await createDialog
      .getByRole("textbox", { name: /^Description/i })
      .fill("Small group, patient pace.");
    await createDialog.getByRole("button", { name: /Create Study Group/i }).click();

    // Toast + the new group appears in the picker.
    await expect(page.getByText(/Study Group created/i)).toBeVisible();
    const groupsList = page.getByRole("list", { name: "Your Study Groups" });
    await expect(groupsList.getByText("Tuesday Night Learners")).toBeVisible();
    await expect(groupsList.getByText(/^Admin$/)).toBeVisible();

    // Open the group home.
    await groupsList.getByText("Tuesday Night Learners").click();
    await expect(page.getByRole("heading", { name: "Tuesday Night Learners" })).toBeVisible();
    // Active badge present, archived banner absent.
    await expect(page.getByText(/^active$/i).first()).toBeVisible();
    await expect(page.getByText(/This group is archived/i)).toBeHidden();

    // Archive via settings → confirm.
    await page.getByRole("button", { name: /Group settings/i }).click();
    const settingsDialog = page.getByRole("dialog", { name: /Group settings/i });
    await expect(settingsDialog).toBeVisible();
    await settingsDialog.getByRole("button", { name: /Archive group/i }).click();

    const confirm = page.getByRole("dialog", { name: /Archive this group/i });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: /^Archive group$/i }).click();
    await expect(page.getByText(/Group archived/i)).toBeVisible();

    // Banner appears, "archived" badge replaces "active".
    await expect(page.getByText(/This group is archived/i)).toBeVisible();
    await expect(page.getByText(/^archived$/i).first()).toBeVisible();

    // Unarchive.
    await page.getByRole("button", { name: /Group settings/i }).click();
    const settingsAgain = page.getByRole("dialog", { name: /Group settings/i });
    await expect(settingsAgain).toBeVisible();
    await settingsAgain.getByRole("button", { name: /Unarchive group/i }).click();
    const confirmUn = page.getByRole("dialog", { name: /Unarchive this group/i });
    await expect(confirmUn).toBeVisible();
    await confirmUn.getByRole("button", { name: /^Unarchive group$/i }).click();
    await expect(page.getByText(/Group unarchived/i)).toBeVisible();
    await expect(page.getByText(/This group is archived/i)).toBeHidden();

    await context.close();
  });

  test("sidebar lists every group the user belongs to and highlights the active one", async ({
    browser,
  }) => {
    // Intent: the sidebar acts as a project switcher (Linear/GitHub pattern).
    // The user's groups are always visible — recognition over recall —
    // independent of which page they're on. Active group on `/g/$id` is
    // marked `aria-current="page"`. Lays the groundwork for tracks /
    // browse / etc. to nest under the active group in later milestones.
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    // Two groups so we can verify "all listed" + "only the active one
    // highlighted" — a single-group fixture would not catch a mistaken
    // `aria-current` on every entry.
    const create = async (name: string) => {
      const res = await context.request.post("/api/v1/g", {
        data: { name },
        headers: { "content-type": "application/json" },
      });
      expect(res.status()).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };
    const aId = await create("Alpha");
    const bId = await create("Beta");

    const yourGroupsNav = page.getByRole("navigation", { name: "Your groups" });

    // On `/`, both groups appear; neither is the current page.
    await page.goto("/");
    await expect(yourGroupsNav.getByRole("link", { name: "Alpha" })).toBeVisible();
    await expect(yourGroupsNav.getByRole("link", { name: "Beta" })).toBeVisible();
    await expect(yourGroupsNav.getByRole("link", { name: "Alpha" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );

    // On `/g/$alpha`, Alpha is `aria-current="page"`; Beta is not.
    await page.goto(`/g/${aId}`);
    await expect(yourGroupsNav.getByRole("link", { name: "Alpha" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(yourGroupsNav.getByRole("link", { name: "Beta" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );

    // Switching via the sidebar — the user does not have to detour through `/`.
    await yourGroupsNav.getByRole("link", { name: "Beta" }).click();
    await expect(page).toHaveURL(`/g/${bId}`);
    await expect(yourGroupsNav.getByRole("link", { name: "Beta" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await context.close();
  });

  test("brand wordmark navigates back to home from any inner page", async ({ browser }) => {
    // Intent: a user inside a group or in /admin can always escape back to
    // the picker via the brand wordmark — Nielsen #4 (consistency &
    // standards), Shneiderman #7 (internal locus of control). Covers both
    // common deep-page entry points; one spec, one affordance.
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    const create = await context.request.post("/api/v1/g", {
      data: { name: "Anywhere Group" },
      headers: { "content-type": "application/json" },
    });
    const { id } = (await create.json()) as { id: string };

    const sidebar = page.getByRole("complementary");
    const brandLink = sidebar.getByRole("link", { name: "Hearth — back to your groups" });

    // From a group page → home.
    await page.goto(`/g/${id}`);
    await brandLink.click();
    await expect(page).toHaveURL("/");

    // From the admin instance page → home.
    await page.goto("/admin/instance");
    await brandLink.click();
    await expect(page).toHaveURL("/");

    await context.close();
  });

  test("operator updates the group name from the settings dialog", async ({ browser }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    // Create via API for speed.
    const create = await context.request.post("/api/v1/g", {
      data: { name: "Old name", description: "old desc" },
      headers: { "content-type": "application/json" },
    });
    expect(create.status()).toBe(201);
    const created = (await create.json()) as { id: string };

    await page.goto(`/g/${created.id}`);
    await expect(page.getByRole("heading", { name: "Old name" })).toBeVisible();

    await page.getByRole("button", { name: /Group settings/i }).click();
    const dialog = page.getByRole("dialog", { name: /Group settings/i });
    const nameInput = dialog.getByRole("textbox", { name: /^Name$/i });
    await expect(nameInput).toHaveValue("Old name");
    await nameInput.fill("New name");
    await dialog.getByRole("button", { name: /Save changes/i }).click();
    await expect(page.getByText(/Group updated/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "New name" })).toBeVisible();

    await context.close();
  });

  test("non-operator does not see the Create CTA and cannot create via UI", async ({ browser }) => {
    // Seed a member-only user with no operator row.
    await seedOperator(BOOTSTRAP_USER);
    const member = await seedOperator({
      userId: "u_e2e_member",
      email: "member@e2e.example.com",
      name: "Member",
    });
    demoteToMember(member.userId);

    const context = await browser.newContext();
    await attachSession(context, member.cookie);
    const page = await context.newPage();

    await page.goto("/");
    await expect(page.getByText(/No Study Groups yet/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Create Study Group/i })).toBeHidden();

    // Direct API call also rejects.
    const reject = await context.request.post("/api/v1/g", {
      data: { name: "Sneaky" },
      headers: { "content-type": "application/json" },
    });
    expect(reject.status()).toBe(403);
    const body = (await reject.json()) as { code: string };
    expect(body.code).toBe("not_instance_operator");

    await context.close();
  });

  test("non-member visiting an existing group sees a 404 (not 403, no existence leak)", async ({
    browser,
  }) => {
    // Operator A creates the group. Member B (non-member of the group) tries
    // to visit by id; the SPA shows the "not found" empty state.
    const opA = await seedOperator(BOOTSTRAP_USER);
    const ctxA = await browser.newContext();
    await attachSession(ctxA, opA.cookie);
    const created = await ctxA.request.post("/api/v1/g", {
      data: { name: "Private group" },
      headers: { "content-type": "application/json" },
    });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    await ctxA.close();

    const memberB = await seedOperator({
      userId: "u_e2e_member_b",
      email: "memberb@e2e.example.com",
      name: "Member B",
    });
    demoteToMember(memberB.userId);
    const ctxB = await browser.newContext();
    await attachSession(ctxB, memberB.cookie);
    const pageB = await ctxB.newPage();

    await pageB.goto(`/g/${id}`);
    await expect(pageB.getByText(/Group not found/i)).toBeVisible();

    // Confirm the API uses 404 with `not_group_member` so existence isn't
    // leaked even by status-code inspection.
    const probe = await ctxB.request.get(`/api/v1/g/${id}`);
    expect(probe.status()).toBe(404);
    const probeBody = (await probe.json()) as { code: string };
    expect(probeBody.code).toBe("not_group_member");

    await ctxB.close();
  });

  test("unauthenticated visit to /g/:id redirects to /", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/g/g_does_not_exist");
    // Anonymous → / (sign-in).
    await expect(page).toHaveURL("/");
    await context.close();
  });
});
