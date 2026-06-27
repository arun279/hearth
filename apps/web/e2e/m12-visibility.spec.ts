import { type BrowserContext, expect, test } from "@playwright/test";
import { attachSession, demoteToMember, resetInstanceState, seedOperator } from "./auth.ts";

// The track creator — auto-enrolled as facilitator. Owns the peer-progress
// setting and is the only viewer who sees every row plus the struggle signal.
const FACILITATOR = {
  userId: "u_e2e_m12_facilitator",
  email: "m12-facilitator@e2e.example.com",
  name: "M12 Facilitator",
};

// A participant who writes a reflection (private content) and completes the
// activity (coarse progress a peer may see).
const AUTHOR = {
  userId: "u_e2e_m12_author",
  email: "m12-author@e2e.example.com",
  name: "M12 Author",
};

// A second enrolled participant — the peer whose view of the roster is shaped
// by the track's peerProgressVisibility setting.
const VIEWER = {
  userId: "u_e2e_m12_viewer",
  email: "m12-viewer@e2e.example.com",
  name: "M12 Viewer",
};

const REFLECT_PART_ID = "p_reflect";
const ACTIVITY_TITLE = "Reflection unit";
// Distinctive marker so a leak of either participant's prose is unmistakable
// in the progress payload (which must carry completion facts only).
const AUTHOR_SECRET = "AUTHOR-PRIVATE-PROSE-DO-NOT-LEAK";
const VIEWER_SECRET = "VIEWER-PRIVATE-PROSE-DO-NOT-LEAK";

const JSON_HEADERS = { "content-type": "application/json" } as const;

type ProgressRow = {
  recordId: string;
  activityId: string;
  participantId: string;
  participantDisplayName: string;
  completionState: "in_progress" | "completed";
  completedAt: string | null;
  retryCount: number | null;
};

async function inviteAndJoin(
  adminCtx: BrowserContext,
  memberCtx: BrowserContext,
  groupId: string,
  email: string,
): Promise<void> {
  const invite = await adminCtx.request.post(`/api/v1/g/${groupId}/invitations`, {
    data: { email },
    headers: JSON_HEADERS,
  });
  expect(invite.status(), `invite ${email}`).toBe(201);
  const { invitation } = (await invite.json()) as { invitation: { token: string } };

  const consume = await memberCtx.request.post("/api/v1/invitations/consume", {
    data: { token: invitation.token },
    headers: JSON_HEADERS,
  });
  expect(consume.status(), `consume ${email}`).toBe(201);
}

async function enroll(ctx: BrowserContext, trackId: string): Promise<void> {
  const res = await ctx.request.post(`/api/v1/tracks/${trackId}/enroll`, {
    data: {},
    headers: JSON_HEADERS,
  });
  expect(res.status(), "self-enroll").toBe(201);
}

async function writeReflection(
  ctx: BrowserContext,
  activityId: string,
  text: string,
): Promise<void> {
  const res = await ctx.request.put(
    `/api/v1/activities/${activityId}/my-record/parts/${REFLECT_PART_ID}/reflection`,
    { data: { text }, headers: JSON_HEADERS },
  );
  expect(res.status(), "save reflection").toBe(200);
}

async function completeActivity(ctx: BrowserContext, activityId: string): Promise<void> {
  const res = await ctx.request.post(`/api/v1/activities/${activityId}/my-record/complete`, {
    data: {},
    headers: JSON_HEADERS,
  });
  expect(res.status(), "mark activity complete").toBe(200);
}

async function getProgress(ctx: BrowserContext, trackId: string): Promise<ProgressRow[]> {
  const res = await ctx.request.get(`/api/v1/tracks/${trackId}/progress`);
  expect(res.status(), "GET progress").toBe(200);
  const { entries } = (await res.json()) as { entries: ProgressRow[] };
  return entries;
}

/**
 * Provision the full cohort: a group + a reflection-only activity, the
 * facilitator (creator), and two enrolled participants who have each written a
 * private reflection. The Author additionally completes the activity, so the
 * roster carries one completed + one in-progress participant.
 */
async function setupCohort(browser: import("@playwright/test").Browser): Promise<{
  groupId: string;
  trackId: string;
  activityId: string;
  facilitatorCtx: BrowserContext;
  authorCtx: BrowserContext;
  viewerCtx: BrowserContext;
}> {
  const facilitator = await seedOperator(FACILITATOR);
  const facilitatorCtx = await browser.newContext();
  await attachSession(facilitatorCtx, facilitator.cookie);

  const groupRes = await facilitatorCtx.request.post("/api/v1/g", {
    data: { name: "M12 Visibility Cohort" },
    headers: JSON_HEADERS,
  });
  expect(groupRes.status()).toBe(201);
  const { id: groupId } = (await groupRes.json()) as { id: string };

  const trackRes = await facilitatorCtx.request.post(`/api/v1/g/${groupId}/tracks`, {
    data: { name: "Reflective Reading", description: "Coarse progress, private content." },
    headers: JSON_HEADERS,
  });
  expect(trackRes.status()).toBe(201);
  const { id: trackId } = (await trackRes.json()) as { id: string };

  const activityRes = await facilitatorCtx.request.post(`/api/v1/tracks/${trackId}/activities`, {
    data: {
      trackId,
      title: ACTIVITY_TITLE,
      parts: [{ kind: "write_reflection", id: REFLECT_PART_ID, prompt: "What stood out?" }],
      flow: { prereqs: [] },
      audience: { kind: "everyone_enrolled" },
      completionRule: { kind: "manual_mark" },
      libraryRefs: [],
      prerequisiteActivityIds: [],
      suggestedNextActivityIds: [],
    },
    headers: JSON_HEADERS,
  });
  expect(activityRes.status()).toBe(201);
  const { id: activityId } = (await activityRes.json()) as { id: string };

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
  await enroll(viewerCtx, trackId);

  await writeReflection(authorCtx, activityId, AUTHOR_SECRET);
  await completeActivity(authorCtx, activityId);
  await writeReflection(viewerCtx, activityId, VIEWER_SECRET);

  return { groupId, trackId, activityId, facilitatorCtx, authorCtx, viewerCtx };
}

test.describe("M12 — Private content + configurable coarse progress", () => {
  test.beforeEach(() => {
    resetInstanceState();
  });

  test("a peer sees coarse completion facts, never another participant's content", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const { trackId, activityId, viewerCtx } = await setupCohort(browser);

    // The peer reads the roster on the default `shared` track: coarse rows for
    // every enrollee with a record, shaped as completion facts only.
    const res = await viewerCtx.request.get(`/api/v1/tracks/${trackId}/progress`);
    expect(res.status()).toBe(200);
    const body = await res.text();
    const { entries } = JSON.parse(body) as { entries: ProgressRow[] };

    const authorRow = entries.find((e) => e.participantId === AUTHOR.userId);
    expect(authorRow, "peer sees the author's coarse row").toBeTruthy();
    expect(authorRow?.completionState).toBe("completed");
    expect(authorRow?.completedAt).not.toBeNull();
    expect(authorRow?.participantDisplayName).toBe(AUTHOR.name);
    // The retry count is a facilitator-only struggle signal — never exposed to
    // a peer, independent of peerProgressVisibility.
    expect(authorRow?.retryCount).toBeNull();

    // #228 structural: no participant's prose travels in the progress payload.
    expect(body).not.toContain(AUTHOR_SECRET);
    expect(body).not.toContain(VIEWER_SECRET);

    // The cross-participant content-read engine is gone, not gated. The
    // record-addressed routes the old visibility model exposed are unrouted.
    const recordGet = await viewerCtx.request.get("/api/v1/records/ar_e2e_probe_000000000");
    expect(recordGet.status(), "GET /records/:id is gone").toBe(404);
    const historyGet = await viewerCtx.request.get(
      "/api/v1/records/ar_e2e_probe_000000000/history",
    );
    expect(historyGet.status(), "GET /records/:id/history is gone").toBe(404);
    const overridePatch = await viewerCtx.request.patch(
      `/api/v1/activities/${activityId}/my-record/visibility-override`,
      { data: { scope: "private" }, headers: JSON_HEADERS },
    );
    expect(overridePatch.status(), "PATCH visibility-override is gone").toBe(404);
  });

  test("the peer-progress setting flips what a peer sees; a facilitator always sees all", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const { trackId, facilitatorCtx, viewerCtx } = await setupCohort(browser);

    // Default `shared`: the peer sees both participants' rows.
    const sharedView = await getProgress(viewerCtx, trackId);
    const sharedParticipants = new Set(sharedView.map((r) => r.participantId));
    expect(sharedParticipants.has(AUTHOR.userId)).toBe(true);
    expect(sharedParticipants.has(VIEWER.userId)).toBe(true);

    // The facilitator flips the track to facilitator-only.
    const patch = await facilitatorCtx.request.patch(
      `/api/v1/tracks/${trackId}/peer-progress-visibility`,
      { data: { visibility: "facilitator_only" }, headers: JSON_HEADERS },
    );
    expect(patch.status()).toBe(200);

    // The peer now sees only their own row — the author's progress is hidden.
    const limitedView = await getProgress(viewerCtx, trackId);
    const limitedParticipants = new Set(limitedView.map((r) => r.participantId));
    expect(limitedParticipants.has(VIEWER.userId)).toBe(true);
    expect(limitedParticipants.has(AUTHOR.userId)).toBe(false);

    // The facilitator still sees every row — and the retry count (struggle
    // signal) is a number for them, where it was null for the peer.
    const facilitatorView = await getProgress(facilitatorCtx, trackId);
    const facilitatorParticipants = new Set(facilitatorView.map((r) => r.participantId));
    expect(facilitatorParticipants.has(AUTHOR.userId)).toBe(true);
    expect(facilitatorParticipants.has(VIEWER.userId)).toBe(true);
    expect(facilitatorView.every((r) => typeof r.retryCount === "number")).toBe(true);

    // A non-authority non-participant cannot set the visibility.
    const denied = await viewerCtx.request.patch(
      `/api/v1/tracks/${trackId}/peer-progress-visibility`,
      { data: { visibility: "shared" }, headers: JSON_HEADERS },
    );
    expect(denied.status()).toBe(403);
  });

  test("the Progress tab renders the coarse roster and the per-activity completion chip", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const { groupId, trackId, facilitatorCtx } = await setupCohort(browser);

    const page = await facilitatorCtx.newPage();
    await page.goto(`/g/${groupId}/t/${trackId}?tab=progress`);

    // The roster lists each participant who has a record, with a coarse cell
    // per activity. The author's cell reads completed.
    const roster = page.getByRole("list", { name: /Track progress by participant/i });
    await expect(roster).toBeVisible();
    await expect(roster.getByText(AUTHOR.name)).toBeVisible();
    await expect(roster.getByText(VIEWER.name)).toBeVisible();
    await expect(
      page.getByRole("img", { name: new RegExp(`${ACTIVITY_TITLE}: completed`, "i") }).first(),
    ).toBeVisible();

    // The Activities tab carries the facilitator-only "N of M completed" count
    // chip — coarse completion.
    await page.goto(`/g/${groupId}/t/${trackId}`);
    await expect(
      page.getByRole("button", { name: /Open activity: Reflection unit/i }),
    ).toBeVisible();
    await expect(page.getByText(/1 of 2 completed/i)).toBeVisible();
  });
});
