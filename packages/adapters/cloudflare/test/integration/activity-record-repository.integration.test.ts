import { env } from "cloudflare:test";
import * as schema from "@hearth/db/schema";
import type {
  ActivityPartId,
  ActivityRecordId,
  LearningActivityDraft,
  LearningActivityId,
  UserId,
} from "@hearth/domain";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { createActivityRecordRepository } from "../../src/activity-record-repository.ts";
import { createKillswitchGate } from "../../src/killswitch.ts";
import { createLearningActivityRepository } from "../../src/learning-activity-repository.ts";
import { createLearningTrackRepository } from "../../src/learning-track-repository.ts";
import { createStudyGroupRepository } from "../../src/study-group-repository.ts";
import { createSystemFlagRepository } from "../../src/system-flag-repository.ts";

/**
 * Real-D1 coverage for the M10 ActivityRecord adapter. This is the
 * empirical check that composite-UNIQUE-index `onConflict` behaves on the
 * deployed SQLite shape: `upsert` idempotency rides the
 * UNIQUE(activity_id, participant_id) DO NOTHING, and `savePartProgress`
 * latest-wins rides the UNIQUE(activity_record_id, part_id) DO UPDATE. A
 * composite-target bug would surface as a duplicate row or a lost write
 * right here.
 */
describe("activity-record adapter (real D1)", () => {
  function buildRepos() {
    const db = drizzle(env.DB, { schema });
    const flags = createSystemFlagRepository({ db });
    const gate = createKillswitchGate(flags);
    return {
      db,
      groups: createStudyGroupRepository({ db, gate }),
      tracksRepo: createLearningTrackRepository({ db, gate }),
      activities: createLearningActivityRepository({ db, gate }),
      records: createActivityRecordRepository({ db, gate }),
    };
  }

  type Db = ReturnType<typeof drizzle<typeof schema>>;
  type Repos = ReturnType<typeof buildRepos>;

  async function seedUser(db: Db, id: string, email: string): Promise<UserId> {
    const now = new Date();
    await db.insert(schema.users).values({
      id,
      email,
      emailVerified: false,
      name: null,
      image: null,
      createdAt: now,
      updatedAt: now,
    });
    return id as UserId;
  }

  /** Create group + track + a two-Part activity + a participant. */
  async function setup(repos: Repos, suffix: string) {
    const creator = await seedUser(repos.db, `u_creator_${suffix}`, `creator_${suffix}@x.com`);
    const participant = await seedUser(repos.db, `u_part_${suffix}`, `part_${suffix}@x.com`);
    const group = await repos.groups.create({ name: "G", createdBy: creator });
    const track = await repos.tracksRepo.create({
      groupId: group.id,
      name: "Track",
      description: null,
      createdBy: creator,
    });
    const draft: LearningActivityDraft = {
      trackId: track.id,
      title: "Activity",
      description: null,
      parts: [
        { kind: "write_reflection", id: "p1", prompt: "Reflect." },
        {
          kind: "quiz",
          id: "p2",
          questions: [{ id: "q1", prompt: "?", shape: { kind: "short_answer" } }],
        },
      ],
      flow: { prereqs: [] },
      audience: { kind: "everyone_enrolled" },
      window: null,
      postClosePolicy: null,
      completionRule: { kind: "manual_mark" },
      libraryRefs: [],
      prerequisiteActivityIds: [],
      suggestedNextActivityIds: [],
    };
    const activity = await repos.activities.create({ draft, createdBy: creator });
    return { participant, activityId: activity.id as LearningActivityId };
  }

  it("upsert is idempotent — two first-touches yield one row, same id", async () => {
    const repos = buildRepos();
    const { participant, activityId } = await setup(repos, "idem");

    const first = await repos.records.upsert({ activityId, participantId: participant });
    const second = await repos.records.upsert({ activityId, participantId: participant });

    expect(second.id).toBe(first.id);
    expect(first.completionState).toBe("in_progress");
    expect(first.visibilityOverride).toBeNull();

    const rows = await repos.db
      .select()
      .from(schema.activityRecords)
      .where(eq(schema.activityRecords.activityId, activityId));
    expect(rows).toHaveLength(1);
  });

  it("byParticipantAndActivity returns null before any touch, the row after", async () => {
    const repos = buildRepos();
    const { participant, activityId } = await setup(repos, "byp");

    expect(await repos.records.byParticipantAndActivity(activityId, participant)).toBeNull();
    const created = await repos.records.upsert({ activityId, participantId: participant });
    const found = await repos.records.byParticipantAndActivity(activityId, participant);
    expect(found?.id).toBe(created.id);
  });

  it("savePartProgress is latest-wins UPSERT — one row per (record, part)", async () => {
    const repos = buildRepos();
    const { participant, activityId } = await setup(repos, "save");
    const record = await repos.records.upsert({ activityId, participantId: participant });
    const p1 = "p1" as ActivityPartId;

    await repos.records.savePartProgress({
      activityRecordId: record.id,
      partId: p1,
      state: { kind: "write_reflection", completed: false, text: "draft one" },
    });
    await repos.records.savePartProgress({
      activityRecordId: record.id,
      partId: p1,
      state: { kind: "write_reflection", completed: false, text: "draft two" },
    });

    const progress = await repos.records.getPartProgress({
      activityRecordId: record.id,
      partId: p1,
    });
    expect(progress?.state).toEqual({
      kind: "write_reflection",
      completed: false,
      text: "draft two",
    });

    const rows = await repos.db
      .select()
      .from(schema.partProgress)
      .where(
        and(
          eq(schema.partProgress.activityRecordId, record.id),
          eq(schema.partProgress.partId, "p1"),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("savePartProgress bumps the parent record's updatedAt in one batch", async () => {
    const repos = buildRepos();
    const { participant, activityId } = await setup(repos, "touch");
    const record = await repos.records.upsert({ activityId, participantId: participant });

    await repos.records.savePartProgress({
      activityRecordId: record.id,
      partId: "p1" as ActivityPartId,
      state: { kind: "write_reflection", completed: false, text: "draft" },
    });

    const after = await repos.records.byParticipantAndActivity(activityId, participant);
    const childRows = await repos.db
      .select()
      .from(schema.partProgress)
      .where(eq(schema.partProgress.activityRecordId, record.id));
    expect(after?.updatedAt.getTime()).toBeGreaterThanOrEqual(record.updatedAt.getTime());
    expect(after?.updatedAt.getTime()).toBe(childRows[0]?.updatedAt.getTime());
  });

  it("listPartProgress returns every saved Part; getPartProgress is null for untouched", async () => {
    const repos = buildRepos();
    const { participant, activityId } = await setup(repos, "list");
    const record = await repos.records.upsert({ activityId, participantId: participant });

    expect(
      await repos.records.getPartProgress({
        activityRecordId: record.id,
        partId: "p1" as ActivityPartId,
      }),
    ).toBeNull();

    await repos.records.savePartProgress({
      activityRecordId: record.id,
      partId: "p1" as ActivityPartId,
      state: { kind: "write_reflection", completed: false, text: "hi" },
    });
    await repos.records.savePartProgress({
      activityRecordId: record.id,
      partId: "p2" as ActivityPartId,
      state: {
        kind: "quiz",
        completed: false,
        answers: [{ questionId: "q1", kind: "short_answer", text: "yes" }],
      },
    });

    const all = await repos.records.listPartProgress(record.id);
    expect(all).toHaveLength(2);
    expect(all.map((p) => p.partId).sort()).toEqual(["p1", "p2"]);
  });

  it("setVisibilityOverride writes the envelope and clears on null", async () => {
    const repos = buildRepos();
    const { participant, activityId } = await setup(repos, "vis");
    const record = await repos.records.upsert({ activityId, participantId: participant });

    await repos.records.setVisibilityOverride(record.id, "private");
    expect(
      (await repos.records.byParticipantAndActivity(activityId, participant))?.visibilityOverride,
    ).toBe("private");

    await repos.records.setVisibilityOverride(record.id, null);
    expect(
      (await repos.records.byParticipantAndActivity(activityId, participant))?.visibilityOverride,
    ).toBeNull();
  });

  it("setVisibilityOverride throws NOT_FOUND for an unknown record", async () => {
    const repos = buildRepos();
    await expect(
      repos.records.setVisibilityOverride("ar_missing" as ActivityRecordId, "track_only"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("getPartProgress surfaces a corrupt stateJson as INVARIANT_VIOLATION", async () => {
    const repos = buildRepos();
    const { participant, activityId } = await setup(repos, "corruptpp");
    const record = await repos.records.upsert({ activityId, participantId: participant });
    const p1 = "p1" as ActivityPartId;
    await repos.records.savePartProgress({
      activityRecordId: record.id,
      partId: p1,
      state: { kind: "write_reflection", completed: false, text: "ok" },
    });
    // Bypass the repo and write a malformed envelope directly.
    await repos.db
      .update(schema.partProgress)
      .set({ stateJson: '{"v":1,"data":{"kind":"nope"}}' })
      .where(
        and(
          eq(schema.partProgress.activityRecordId, record.id),
          eq(schema.partProgress.partId, "p1"),
        ),
      );
    await expect(
      repos.records.getPartProgress({ activityRecordId: record.id, partId: p1 }),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION", reason: "envelope_invalid" });
  });

  it("byParticipantAndActivity surfaces a corrupt visibilityOverrideJson as INVARIANT_VIOLATION", async () => {
    const repos = buildRepos();
    const { participant, activityId } = await setup(repos, "corruptvis");
    const record = await repos.records.upsert({ activityId, participantId: participant });
    await repos.db
      .update(schema.activityRecords)
      .set({ visibilityOverrideJson: '{"v":1,"data":{"preference":"nope"}}' })
      .where(eq(schema.activityRecords.id, record.id));
    await expect(
      repos.records.byParticipantAndActivity(activityId, participant),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION", reason: "envelope_invalid" });
  });
});
