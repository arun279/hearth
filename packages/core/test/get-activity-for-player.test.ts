import {
  DomainError,
  type LearningActivity,
  type LearningActivityId,
  type LearningTrackId,
  type LibraryItemId,
  type LibraryRevision,
  type LibraryRevisionId,
} from "@hearth/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getActivityForPlayer } from "../src/use-cases/get-activity-for-player.ts";
import {
  ACTIVE_GROUP,
  ACTOR,
  ACTOR_ID,
  GROUP_ID,
  makeActivities,
  makeGroups,
  makeLibrary,
  makePolicy,
  makeStorage,
  makeTracks,
  makeUsers,
  membership,
  TEST_NOW,
} from "./_helpers.ts";

const TRACK_ID = "t_1" as LearningTrackId;
const ACTIVITY_ID = "a_1" as LearningActivityId;
const ITEM_PINNED = "li_pinned" as LibraryItemId;
const ITEM_UNPINNED = "li_unpinned" as LibraryItemId;
const REV_PINNED = "lr_pinned" as LibraryRevisionId;
const REV_CURRENT = "lr_current" as LibraryRevisionId;

const track = {
  id: TRACK_ID,
  groupId: GROUP_ID,
  name: "T",
  description: null,
  status: "active" as const,
  pausedAt: null,
  archivedAt: null,
  archivedBy: null,
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
};

function makeActivity(overrides: Partial<LearningActivity> = {}): LearningActivity {
  return {
    id: ACTIVITY_ID,
    trackId: TRACK_ID,
    title: "Greetings",
    description: null,
    parts: [
      {
        kind: "read_library_item",
        id: "p_read",
        libraryItemId: ITEM_PINNED,
        pinnedRevisionId: REV_PINNED,
        title: "Chapter 1",
      },
      {
        kind: "listen_audio",
        id: "p_audio",
        libraryItemId: ITEM_UNPINNED,
        title: "Dialogue",
      },
      {
        kind: "embed",
        id: "p_embed",
        provider: "youtube",
        url: "https://youtube.com/watch?v=abc",
      },
      {
        kind: "write_reflection",
        id: "p_reflection",
        prompt: "How did it feel?",
      },
    ],
    flow: { prereqs: [], displayOrder: ["p_read", "p_audio", "p_embed", "p_reflection"] },
    audience: { kind: "everyone_enrolled" },
    window: null,
    postClosePolicy: null,
    completionRule: { kind: "manual_mark" },
    participationMode: "individual",
    libraryRefs: [
      {
        id: "alr_1",
        activityId: ACTIVITY_ID,
        libraryItemId: ITEM_PINNED,
        pinnedRevisionId: REV_PINNED,
      },
      {
        id: "alr_2",
        activityId: ACTIVITY_ID,
        libraryItemId: ITEM_UNPINNED,
        pinnedRevisionId: null,
      },
    ],
    prerequisiteActivityIds: [],
    suggestedNextActivityIds: [],
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    ...overrides,
  };
}

function revision(id: LibraryRevisionId, itemId: LibraryItemId, mimeType: string): LibraryRevision {
  return {
    id,
    libraryItemId: itemId,
    revisionNumber: 1,
    storageKey: `library/g/i/${id}`,
    mimeType,
    sizeBytes: 100,
    originalFilename: null,
    uploadedBy: ACTOR_ID,
    uploadedAt: TEST_NOW,
  };
}

function depsOk(overrides?: { now?: Date; activity?: LearningActivity }) {
  const activity = overrides?.activity ?? makeActivity();
  const now = overrides?.now ?? TEST_NOW;
  const users = makeUsers(ACTOR);
  const groups = makeGroups({
    byId: vi.fn(async () => ACTIVE_GROUP),
    membership: vi.fn(async () => membership({ role: "participant" })),
  });
  const tracks = makeTracks({
    byId: vi.fn(async () => track),
    enrollment: vi.fn(async () => ({
      trackId: TRACK_ID,
      userId: ACTOR_ID,
      role: "participant" as const,
      enrolledAt: now,
      leftAt: null,
      leftBy: null,
    })),
  });
  const activities = makeActivities({ byId: vi.fn(async () => activity) });
  const library = makeLibrary({
    currentRevision: vi.fn(async (itemId: LibraryItemId) =>
      itemId === ITEM_UNPINNED ? revision(REV_CURRENT, itemId, "audio/mpeg") : null,
    ),
    revisionById: vi.fn(async (id: LibraryRevisionId) => {
      if (id === REV_PINNED) return revision(REV_PINNED, ITEM_PINNED, "application/pdf");
      if (id === REV_CURRENT) return revision(REV_CURRENT, ITEM_UNPINNED, "audio/mpeg");
      return null;
    }),
  });
  const storage = makeStorage({
    getDownloadUrl: vi.fn(
      async ({ key, ttlSeconds }) => `https://r2.example.com/${key}?signed&ttl=${ttlSeconds}`,
    ),
  });
  const policy = makePolicy({ getOperator: vi.fn(async () => null) });
  const clock = { now: () => now };

  return { users, groups, tracks, policy, activities, library, storage, clock };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getActivityForPlayer", () => {
  it("resolves a pinned revision and a current revision, signs read URLs at 1h TTL", async () => {
    const deps = depsOk();
    const result = await getActivityForPlayer({ actor: ACTOR_ID, id: ACTIVITY_ID }, deps);

    expect(result.accessState).toBe("open");
    expect(result.viewer.enrollmentStatus).toBe("participant");

    // Only read_library_item + listen_audio parts produce resolved refs;
    // embed + write_reflection are absent.
    const byPartId = new Map(result.resolvedRefs.map((r) => [r.partId, r]));
    expect([...byPartId.keys()].sort()).toEqual(["p_audio", "p_read"]);

    const pinned = byPartId.get("p_read");
    expect(pinned?.isPinned).toBe(true);
    expect(pinned?.revisionId).toBe(REV_PINNED);
    expect(pinned?.mimeType).toBe("application/pdf");
    expect(pinned?.readUrl).toContain("library/g/i/lr_pinned");

    const audio = byPartId.get("p_audio");
    expect(audio?.isPinned).toBe(false);
    expect(audio?.revisionId).toBe(REV_CURRENT);
    expect(audio?.mimeType).toBe("audio/mpeg");

    // TTL=3600s on every signed URL
    expect(deps.storage.getDownloadUrl).toHaveBeenCalledTimes(2);
    for (const call of (deps.storage.getDownloadUrl as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[0].ttlSeconds).toBe(3600);
    }
  });

  it("returns 404 (NOT_FOUND) for a viewer not in a subset audience", async () => {
    const restrictedActivity = makeActivity({
      audience: { kind: "subset", userIds: ["u_someone_else" as never] },
    });
    const deps = depsOk({ activity: restrictedActivity });
    await expect(
      getActivityForPlayer({ actor: ACTOR_ID, id: ACTIVITY_ID }, deps),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(deps.storage.getDownloadUrl).not.toHaveBeenCalled();
  });

  it("returns 404 (NOT_FOUND) when post-close 'hidden' policy is past", async () => {
    const closedAt = new Date("2026-05-01T00:00:00.000Z").getTime();
    const after = new Date("2026-05-02T00:00:00.000Z");
    const closedActivity = makeActivity({
      window: { opensAt: null, dueAt: null, closesAt: closedAt },
      postClosePolicy: { kind: "hidden" },
    });
    const deps = depsOk({ activity: closedActivity, now: after });
    await expect(
      getActivityForPlayer({ actor: ACTOR_ID, id: ACTIVITY_ID }, deps),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns accessState='locked' when window closed with visible_locked policy", async () => {
    const closedAt = new Date("2026-05-01T00:00:00.000Z").getTime();
    const after = new Date("2026-05-02T00:00:00.000Z");
    const lockedActivity = makeActivity({
      window: { opensAt: null, dueAt: null, closesAt: closedAt },
      postClosePolicy: { kind: "visible_locked" },
    });
    const deps = depsOk({ activity: lockedActivity, now: after });
    const result = await getActivityForPlayer({ actor: ACTOR_ID, id: ACTIVITY_ID }, deps);
    expect(result.accessState).toBe("locked");
    expect(result.resolvedRefs).toHaveLength(2);
  });

  it("returns accessState='pre_open' before the window opens (no URL signing — saves R2 ops)", async () => {
    const opensAt = new Date("2026-06-01T00:00:00.000Z").getTime();
    const before = new Date("2026-05-15T00:00:00.000Z");
    const preActivity = makeActivity({
      window: { opensAt, dueAt: null, closesAt: null },
      postClosePolicy: null,
    });
    const deps = depsOk({ activity: preActivity, now: before });
    const result = await getActivityForPlayer({ actor: ACTOR_ID, id: ACTIVITY_ID }, deps);
    expect(result.accessState).toBe("pre_open");
    expect(result.resolvedRefs).toHaveLength(0);
    expect(deps.storage.getDownloadUrl).not.toHaveBeenCalled();
  });

  it("propagates DomainError from missing pinned revision", async () => {
    const deps = depsOk();
    deps.library.revisionById = vi.fn(async () => null);
    await expect(
      getActivityForPlayer({ actor: ACTOR_ID, id: ACTIVITY_ID }, deps),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("reports 'facilitator' enrollmentStatus when the viewer is a facilitator", async () => {
    const deps = depsOk();
    deps.tracks.enrollment = vi.fn(async () => ({
      trackId: TRACK_ID,
      userId: ACTOR_ID,
      role: "facilitator" as const,
      enrolledAt: TEST_NOW,
      leftAt: null,
      leftBy: null,
    }));
    const result = await getActivityForPlayer({ actor: ACTOR_ID, id: ACTIVITY_ID }, deps);
    expect(result.viewer.enrollmentStatus).toBe("facilitator");
  });

  it("reports 'not_enrolled' for a viewer with no enrollment row (group admin path)", async () => {
    const deps = depsOk();
    deps.groups.membership = vi.fn(async () => membership({ role: "admin" }));
    deps.tracks.enrollment = vi.fn(async () => null);
    const result = await getActivityForPlayer({ actor: ACTOR_ID, id: ACTIVITY_ID }, deps);
    expect(result.viewer.enrollmentStatus).toBe("not_enrolled");
  });
});
