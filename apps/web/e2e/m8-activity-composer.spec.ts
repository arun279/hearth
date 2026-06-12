import { expect, test } from "@playwright/test";
import { attachSession, resetInstanceState, seedGroupWithTrack, seedOperator } from "./auth.ts";

const BOOTSTRAP_USER = {
  userId: "u_e2e_op_m8",
  email: "m8-bootstrap@e2e.example.com",
  name: "M8 Operator",
};

test.describe("M8 — Activity composer", () => {
  test.beforeEach(() => {
    resetInstanceState();
  });

  test("facilitator composes a Reflection + Embed activity, then edits it", async ({ browser }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    // Seed a group + track via API so the test stays focused on the
    // composer surface rather than the upstream creation flows already
    // exercised by m2/m4.
    const { groupId, trackId } = await seedGroupWithTrack(context, {
      groupName: "Tuesday Night Learners",
      trackName: "Beginner Spanish",
      description: "A patient pace through the basics.",
    });

    await page.goto(`/g/${groupId}/t/${trackId}`);
    await expect(page.getByRole("heading", { name: "Beginner Spanish" })).toBeVisible();

    // Activities tab is the default; empty state renders with the
    // facilitator-targeted copy and a "+ New activity" button.
    await expect(page.getByText(/No activities yet/i)).toBeVisible();
    const newActivityBtn = page.getByRole("button", { name: /New activity/i });
    await expect(newActivityBtn).toBeVisible();
    await newActivityBtn.click();

    // Composer dialog opens with the New activity heading + sections.
    const composer = page.getByRole("dialog", { name: /New activity/i });
    await expect(composer).toBeVisible();

    await composer.getByRole("textbox", { name: /^Title$/i }).fill("Greetings & introductions");

    // Add a Reflection + an Embed Part. Each kind is a button in the
    // palette — clicking adds a row to the Parts list above. The
    // Reflection prompt and the Embed URL are required by the domain
    // Zod (min(1) / https URL).
    await composer.getByRole("button", { name: /Reflection/i }).click();
    await composer
      .getByRole("textbox", { name: /Reflection prompt/i })
      .fill("What's your favorite Spanish phrase so far?");
    await composer.getByRole("button", { name: /^Embed/i }).click();
    await composer
      .getByRole("textbox", { name: /Embed URL/i })
      .fill("https://www.youtube.com/embed/dQw4w9WgXcQ");

    // Save the activity. Toast confirms; dialog closes.
    await composer.getByRole("button", { name: /Create activity/i }).click();
    await expect(page.getByText(/Activity created/i)).toBeVisible();
    await expect(composer).toBeHidden();

    // The Activities tab now renders the new activity row with the
    // title, the Part-kind icon strip, and the audience badge.
    const activityCard = page.getByText("Greetings & introductions");
    await expect(activityCard).toBeVisible();
    await expect(page.getByText(/2 parts/)).toBeVisible();
    await expect(page.getByText(/Everyone enrolled/)).toBeVisible();

    // Edit flow: clicking the row routes to the Activity Player surface
    // for everyone (including facilitators); the composer reopens via
    // the explicit Edit pencil affordance on the row, gated on
    // facilitator authority.
    await page.getByRole("button", { name: /Edit activity: Greetings & introductions/i }).click();
    const editDialog = page.getByRole("dialog", { name: /Edit activity/i });
    await expect(editDialog).toBeVisible();
    const titleField = editDialog.getByRole("textbox", { name: /^Title$/i });
    await expect(titleField).toHaveValue("Greetings & introductions");
    await titleField.fill("Greetings & icebreakers");
    await editDialog.getByRole("button", { name: /Save changes/i }).click();
    await expect(page.getByText(/Activity updated/i)).toBeVisible();
    await expect(page.getByText("Greetings & icebreakers")).toBeVisible();
  });

  test("facilitator deletes an activity through the destructive confirm", async ({ browser }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    const { groupId, trackId } = await seedGroupWithTrack(context, {
      groupName: "Tuesday Night Learners",
      trackName: "Beginner Spanish",
    });

    await page.goto(`/g/${groupId}/t/${trackId}`);
    await page.getByRole("button", { name: /New activity/i }).click();
    const composer = page.getByRole("dialog", { name: /New activity/i });
    await composer.getByRole("textbox", { name: /^Title$/i }).fill("Throwaway");
    await composer.getByRole("button", { name: /Reflection/i }).click();
    await composer.getByRole("textbox", { name: /Reflection prompt/i }).fill("Anything?");
    await composer.getByRole("button", { name: /Create activity/i }).click();
    await expect(page.getByText(/Activity created/i)).toBeVisible();

    // Re-open in edit mode via the row's Edit pencil (row click routes
    // to the player, not the composer) + click Delete. The destructive
    // confirm requires typing "delete" before the button enables —
    // proves the confirmation guard is live across the M8 surface.
    await page.getByRole("button", { name: /Edit activity: Throwaway/i }).click();
    const editDialog = page.getByRole("dialog", { name: /Edit activity/i });
    await editDialog.getByRole("button", { name: /^Delete$/i }).click();
    const confirm = page.getByRole("dialog", { name: /Delete this activity/i });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("textbox").fill("delete");
    await confirm.getByRole("button", { name: /Delete activity/i }).click();
    await expect(page.getByText(/Activity deleted/i)).toBeVisible();
    await expect(page.getByText("Throwaway")).toBeHidden();
  });

  test("facilitator narrows audience to a subset via the picker", async ({ browser }) => {
    const op = await seedOperator(BOOTSTRAP_USER);
    const context = await browser.newContext();
    await attachSession(context, op.cookie);
    const page = await context.newPage();

    const { groupId, trackId } = await seedGroupWithTrack(context, {
      groupName: "Tuesday Night Learners",
      trackName: "Beginner Spanish",
    });

    await page.goto(`/g/${groupId}/t/${trackId}`);
    await page.getByRole("button", { name: /New activity/i }).click();
    const composer = page.getByRole("dialog", { name: /New activity/i });
    await composer.getByRole("textbox", { name: /^Title$/i }).fill("Pronunciation lab");
    await composer.getByRole("button", { name: /Reflection/i }).click();
    await composer
      .getByRole("textbox", { name: /Reflection prompt/i })
      .fill("Record yourself rolling the R.");

    // Switch audience to subset; the roster appears with the lone
    // facilitator (the seeded operator who created the track). The
    // Field component nests the <select> inside its <label>, which
    // means the select's accessible name picks up the option text;
    // selecting by combobox-role + name regex matches the select
    // unambiguously across that quirk.
    const audienceSelect = composer.getByRole("combobox", { name: /Audience/i });
    await audienceSelect.selectOption("subset");

    // Pick the lone enrollee (the facilitator) and save. The use case
    // re-validates every userId against current track enrollments at
    // write time, so a successful round-trip proves the picker
    // serialized the userId correctly into audience.userIds.
    await composer.getByRole("checkbox").first().check();
    await composer.getByRole("button", { name: /Create activity/i }).click();
    await expect(page.getByText(/Activity created/i)).toBeVisible();
    await expect(page.getByText("Pronunciation lab")).toBeVisible();
    // The list row shows the "narrowed" badge whenever audienceKind is
    // subset — confirms the row projection picked up the narrowed shape.
    await expect(page.getByText(/narrowed/i).first()).toBeVisible();
  });
});
