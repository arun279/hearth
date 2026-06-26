import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { attachSession, demoteToMember, resetInstanceState, seedOperator } from "./auth.ts";

// The facilitator who composes the activity and reads the roster to learn the
// participant's recordId (the cross-participant read handle the owner path
// hides). The track creator is auto-enrolled as facilitator.
const FACILITATOR = {
  userId: "u_e2e_m12_facilitator",
  email: "m12-facilitator@e2e.example.com",
  name: "M12 Facilitator",
};

// The participant whose record is the subject under test: they write a
// reflection (creating the record) and drive the <VisibilitySelector>.
const AUTHOR = {
  userId: "u_e2e_m12_author",
  email: "m12-author@e2e.example.com",
  name: "M12 Author",
};

// The cross-participant viewer: a group member who reads the author's record
// id directly — first without a track enrollment (hidden -> 404), then as a
// co-enrollee (summary, then full once the author widens scope).
const VIEWER = {
  userId: "u_e2e_m12_viewer",
  email: "m12-viewer@e2e.example.com",
  name: "M12 Viewer",
};

const REFLECT_PART_ID = "p_reflect";
const REFLECTION_TEXT = "Only my track should read this in full.";

type SummaryBody = {
  scope: "summary";
  recordId: string;
  activityId: string;
  participantId: string;
  participantDisplayName: string;
  completionState: string;
};

type FullBody = {
  scope: "full";
  id: string;
  participantId: string;
  participantDisplayName: string;
  parts: readonly unknown[];
};

async function inviteAndJoin(
  adminCtx: BrowserContext,
  memberCtx: BrowserContext,
  groupId: string,
  email: string,
): Promise<void> {
  const approve = await adminCtx.request.post("/api/v1/instance/approved-emails", {
    data: { email },
    headers: { "content-type": "application/json" },
  });
  expect(approve.status(), `approve ${email}`).toBe(201);

  const invite = await adminCtx.request.post(`/api/v1/g/${groupId}/invitations`, {
    data: { email },
    headers: { "content-type": "application/json" },
  });
  expect(invite.status(), `invite ${email}`).toBe(201);
  const { invitation } = (await invite.json()) as { invitation: { token: string } };

  const consume = await memberCtx.request.post("/api/v1/invitations/consume", {
    data: { token: invitation.token },
    headers: { "content-type": "application/json" },
  });
  expect(consume.status(), `consume ${email}`).toBe(201);
}

async function enroll(ctx: BrowserContext, trackId: string): Promise<void> {
  const res = await ctx.request.post(`/api/v1/tracks/${trackId}/enroll`, {
    data: {},
    headers: { "content-type": "application/json" },
  });
  expect(res.status(), "self-enroll").toBe(201);
}

// Drive the wired <VisibilitySelector> in the player's ReflectPart. Each set
// opens the popover, performs the action, waits for the PATCH to land, then
// closes the popover so the next interaction starts from a known state.
async function pickVisibilityRadio(page: Page, optionName: RegExp): Promise<void> {
  await page.getByRole("button", { name: /Visibility:/ }).click();
  const patched = page.waitForResponse(
    (r) => r.url().includes("/visibility-override") && r.request().method() === "PATCH",
  );
  await page.getByRole("radio", { name: optionName }).click();
  expect((await patched).status()).toBe(200);
  await page.keyboard.press("Escape");
}

async function clearVisibilityToDefault(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Visibility:/ }).click();
  const patched = page.waitForResponse(
    (r) => r.url().includes("/visibility-override") && r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: /Use my default/ }).click();
  expect((await patched).status()).toBe(200);
  await page.keyboard.press("Escape");
}

test.describe("M12 — Visibility scope on cross-participant record reads", () => {
  test.beforeEach(() => {
    resetInstanceState();
  });

  test("a peer's record read is projected by the author's visibility scope", async ({
    browser,
  }) => {
    test.setTimeout(120_000);

    // Facilitator composes the group + track + a reflection-only activity.
    const facilitator = await seedOperator(FACILITATOR);
    const facilitatorCtx = await browser.newContext();
    await attachSession(facilitatorCtx, facilitator.cookie);

    const groupRes = await facilitatorCtx.request.post("/api/v1/g", {
      data: { name: "M12 Visibility Cohort" },
      headers: { "content-type": "application/json" },
    });
    expect(groupRes.status()).toBe(201);
    const { id: groupId } = (await groupRes.json()) as { id: string };

    const trackRes = await facilitatorCtx.request.post(`/api/v1/g/${groupId}/tracks`, {
      data: { name: "Reflective Reading", description: "Per-participant visibility." },
      headers: { "content-type": "application/json" },
    });
    expect(trackRes.status()).toBe(201);
    const { id: trackId } = (await trackRes.json()) as { id: string };

    const activityRes = await facilitatorCtx.request.post(`/api/v1/tracks/${trackId}/activities`, {
      data: {
        trackId,
        title: "Reflection unit",
        parts: [{ kind: "write_reflection", id: REFLECT_PART_ID, prompt: "What stood out?" }],
        flow: { prereqs: [] },
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

    // Author + Viewer join the group; the Author also enrolls in the track.
    const author = await seedOperator(AUTHOR);
    demoteToMember(author.userId);
    const authorCtx = await browser.newContext();
    await attachSession(authorCtx, author.cookie);
    await inviteAndJoin(facilitatorCtx, authorCtx, groupId, AUTHOR.email);
    await enroll(authorCtx, trackId);

    const viewer = await seedOperator(VIEWER);
    demoteToMember(viewer.userId);
    const viewerCtx = await browser.newContext();
    await attachSession(viewerCtx, viewer.cookie);
    await inviteAndJoin(facilitatorCtx, viewerCtx, groupId, VIEWER.email);

    // The Author writes a reflection (creating the record) and pins the record
    // to "Just me" (private) via the wired selector.
    const authorPage = await authorCtx.newPage();
    await authorPage.goto(`/g/${groupId}/t/${trackId}/a/${activityId}`);
    const reflection = authorPage.getByRole("textbox", { name: /Your reflection/i });
    await expect(reflection).toBeVisible();
    await reflection.fill(REFLECTION_TEXT);
    await expect(authorPage.getByText("Saved", { exact: true })).toBeVisible();

    await pickVisibilityRadio(authorPage, /Just me/);
    await expect(authorPage.getByRole("button", { name: /Visibility:\s*Just me/ })).toBeVisible();

    // The facilitator roster is the only surface that hands out the recordId.
    const rosterRes = await facilitatorCtx.request.get(
      `/api/v1/activities/${activityId}/participants`,
    );
    expect(rosterRes.status()).toBe(200);
    const { entries } = (await rosterRes.json()) as {
      entries: readonly { recordId: string; participantId: string }[];
    };
    const authorRow = entries.find((e) => e.participantId === author.userId);
    expect(authorRow, "author has a roster row").toBeTruthy();
    const recordId = authorRow?.recordId ?? "";
    expect(recordId).not.toBe("");

    // A non-enrolled group member resolves `hidden` -> 404, byte-identical to a
    // missing record: the record id is not an enumeration oracle.
    const hiddenRes = await viewerCtx.request.get(`/api/v1/records/${recordId}`);
    expect(hiddenRes.status()).toBe(404);
    const missingRes = await viewerCtx.request.get("/api/v1/records/ar_does_not_exist_000000000");
    expect(missingRes.status()).toBe(404);
    expect(await hiddenRes.text()).toBe(await missingRes.text());

    // As a co-enrollee under `private`, the viewer resolves `summary` — six
    // existence-and-completion fields, no working state.
    await enroll(viewerCtx, trackId);
    const summaryRes = await viewerCtx.request.get(`/api/v1/records/${recordId}`);
    expect(summaryRes.status()).toBe(200);
    const summary = (await summaryRes.json()) as SummaryBody & Record<string, unknown>;
    expect(summary.scope).toBe("summary");
    expect(summary.recordId).toBe(recordId);
    expect(summary.participantId).toBe(author.userId);
    expect(summary.participantDisplayName).toBe(AUTHOR.name);
    // No working state leaks through the summary projection.
    expect(summary["id"]).toBeUndefined();
    expect(summary["parts"]).toBeUndefined();
    expect(summary["partHistoryCount"]).toBeUndefined();
    expect(summary["visibilityOverride"]).toBeUndefined();
    expect(JSON.stringify(summary)).not.toContain(REFLECTION_TEXT);
    // The history sibling is full working state — redacted for a summary viewer.
    const summaryHistory = await viewerCtx.request.get(`/api/v1/records/${recordId}/history`);
    expect(summaryHistory.status()).toBe(404);

    // The Author widens scope back to the account default ("Track"); the
    // co-enrollee now resolves `full` and reads the reflection text.
    await clearVisibilityToDefault(authorPage);
    await expect(
      authorPage.getByRole("button", { name: /Visibility:\s*Your default/ }),
    ).toBeVisible();

    const fullRes = await viewerCtx.request.get(`/api/v1/records/${recordId}`);
    expect(fullRes.status()).toBe(200);
    const full = (await fullRes.json()) as FullBody;
    expect(full.scope).toBe("full");
    expect(full.id).toBe(recordId);
    expect(full.participantId).toBe(author.userId);
    expect(Array.isArray(full.parts)).toBe(true);
    expect(JSON.stringify(full.parts)).toContain(REFLECTION_TEXT);
  });
});
