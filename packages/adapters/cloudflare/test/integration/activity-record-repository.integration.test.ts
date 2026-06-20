import { env } from "cloudflare:test";
import * as schema from "@hearth/db/schema";
import type {
  ActivityPartId,
  ActivityRecordId,
  LearningActivityDraft,
  LearningActivityId,
  LibraryRevisionId,
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
          questions: [
            {
              id: "q1",
              prompt: "?",
              shape: { kind: "short_answer", alsoAccept: [], exactMatch: false },
            },
          ],
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

  it("setCompletion writes the rollup + completedAt and 404s an unknown record", async () => {
    const repos = buildRepos();
    const { participant, activityId } = await setup(repos, "complete");
    const record = await repos.records.upsert({ activityId, participantId: participant });
    const at = new Date();

    await repos.records.setCompletion({ id: record.id, state: "completed", at });
    const done = await repos.records.byParticipantAndActivity(activityId, participant);
    expect(done?.completionState).toBe("completed");
    expect(done?.completedAt?.getTime()).toBe(at.getTime());

    await expect(
      repos.records.setCompletion({
        id: "ar_missing" as ActivityRecordId,
        state: "completed",
        at,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("setPartCompletion patches ONLY completed on an existing envelope (text preserved)", async () => {
    const repos = buildRepos();
    const { participant, activityId } = await setup(repos, "setpc");
    const record = await repos.records.upsert({ activityId, participantId: participant });
    const p1 = "p1" as ActivityPartId;
    await repos.records.savePartProgress({
      activityRecordId: record.id,
      partId: p1,
      state: { kind: "write_reflection", completed: false, text: "my prose" },
    });

    await repos.records.setPartCompletion({
      activityRecordId: record.id,
      partId: p1,
      completed: true,
      initialState: { kind: "write_reflection", completed: false, text: "" },
    });

    const progress = await repos.records.getPartProgress({
      activityRecordId: record.id,
      partId: p1,
    });
    expect(progress?.state).toEqual({
      kind: "write_reflection",
      completed: true,
      text: "my prose",
    });
  });

  it("setPartCompletion creates the row at initialState when none exists", async () => {
    const repos = buildRepos();
    const { participant, activityId } = await setup(repos, "setpcnew");
    const record = await repos.records.upsert({ activityId, participantId: participant });
    const p2 = "p2" as ActivityPartId;

    await repos.records.setPartCompletion({
      activityRecordId: record.id,
      partId: p2,
      completed: true,
      initialState: { kind: "quiz", completed: false, answers: [] },
    });

    const progress = await repos.records.getPartProgress({
      activityRecordId: record.id,
      partId: p2,
    });
    expect(progress?.state).toEqual({ kind: "quiz", completed: true, answers: [] });
  });

  it("setPartCompletion + concurrent autosave: final row carries both latest text AND toggled completed", async () => {
    const repos = buildRepos();
    const { participant, activityId } = await setup(repos, "clobber");
    const record = await repos.records.upsert({ activityId, participantId: participant });
    const p1 = "p1" as ActivityPartId;
    await repos.records.savePartProgress({
      activityRecordId: record.id,
      partId: p1,
      state: { kind: "write_reflection", completed: false, text: "first" },
    });

    // The autosave (full-envelope write of the new text) and the targeted
    // completion patch race. Because setPartCompletion patches only
    // $.data.completed onto whatever is currently persisted (not a
    // read-modify-write of the whole envelope), the autosave's text and the
    // completion flag both survive regardless of ordering.
    await Promise.all([
      repos.records.savePartProgress({
        activityRecordId: record.id,
        partId: p1,
        state: { kind: "write_reflection", completed: false, text: "second" },
      }),
      repos.records.setPartCompletion({
        activityRecordId: record.id,
        partId: p1,
        completed: true,
        initialState: { kind: "write_reflection", completed: false, text: "" },
      }),
    ]);

    const progress = await repos.records.getPartProgress({
      activityRecordId: record.id,
      partId: p1,
    });
    expect(progress?.state).toMatchObject({ kind: "write_reflection", completed: true });
    expect((progress?.state as { text: string }).text).toBe("second");
  });

  it("appendPartHistory + listPartHistory round-trip reason + revisionIdAtTime", async () => {
    const repos = buildRepos();
    const { participant, activityId } = await setup(repos, "history");
    const record = await repos.records.upsert({ activityId, participantId: participant });
    const p1 = "p1" as ActivityPartId;

    await repos.records.appendPartHistory({
      activityRecordId: record.id,
      partId: p1,
      snapshot: { kind: "write_reflection", completed: true, text: "v1" },
      reason: "retry",
    });
    await repos.records.appendPartHistory({
      activityRecordId: record.id,
      partId: p1,
      snapshot: { kind: "write_reflection", completed: false, text: "v2" },
      reason: "revision_bump",
      revisionIdAtTime: "lr_x" as LibraryRevisionId,
    });

    const history = await repos.records.listPartHistory(record.id);
    expect(history).toHaveLength(2);
    const byReason = new Map(history.map((h) => [h.reason, h]));
    expect(byReason.get("retry")?.revisionIdAtTime).toBeNull();
    expect(byReason.get("revision_bump")?.revisionIdAtTime).toBe("lr_x");
    expect(byReason.get("retry")?.snapshot).toEqual({
      kind: "write_reflection",
      completed: true,
      text: "v1",
    });

    expect(await repos.records.countPartHistory(record.id)).toBe(2);
    const filtered = await repos.records.listPartHistory(record.id, { partId: p1 });
    expect(filtered).toHaveLength(2);
  });

  it("reopenAgainstRevision archives 50 Parts in one pass, resets state, advances updatedAt, idempotent on re-run", async () => {
    const repos = buildRepos();
    const { participant, activityId } = await setup(repos, "reopen50");
    const record = await repos.records.upsert({ activityId, participantId: participant });
    const newRev = "lr_v2" as LibraryRevisionId;

    const partIds: ActivityPartId[] = [];
    for (let i = 0; i < 50; i++) {
      const partId = `bp_${i}` as ActivityPartId;
      partIds.push(partId);
      await repos.records.savePartProgress({
        activityRecordId: record.id,
        partId,
        state: { kind: "read_library_item", completed: true, scrollPosition: i },
      });
    }
    const before = await repos.records.byParticipantAndActivity(activityId, participant);

    await repos.records.reopenAgainstRevision({
      recordId: record.id,
      newRevisionId: newRev,
      affectedPartIds: partIds,
      reason: "revision_bump",
    });

    const history = await repos.records.listPartHistory(record.id);
    expect(history).toHaveLength(50);
    expect(history.every((h) => h.reason === "revision_bump")).toBe(true);
    expect(history.every((h) => h.revisionIdAtTime === newRev)).toBe(true);
    expect(history.every((h) => (h.snapshot as { completed: boolean }).completed === true)).toBe(
      true,
    );

    const progress = await repos.records.listPartProgress(record.id);
    expect(progress).toHaveLength(50);
    expect(
      progress.every((p) => p.state.kind === "read_library_item" && p.state.completed === false),
    ).toBe(true);
    expect(
      progress.every((p) => !("scrollPosition" in p.state) || p.state.scrollPosition === undefined),
    ).toBe(true);

    const after = await repos.records.byParticipantAndActivity(activityId, participant);
    expect(after?.updatedAt.getTime()).toBeGreaterThanOrEqual(before?.updatedAt.getTime() ?? 0);

    // Second invocation with the same newRevisionId is a no-op (idempotent).
    await repos.records.reopenAgainstRevision({
      recordId: record.id,
      newRevisionId: newRev,
      affectedPartIds: partIds,
      reason: "revision_bump",
    });
    expect(await repos.records.countPartHistory(record.id)).toBe(50);
  });

  it("reopenAgainstRevision with facilitator_reset (null revision) is never deduped", async () => {
    const repos = buildRepos();
    const { participant, activityId } = await setup(repos, "facreset");
    const record = await repos.records.upsert({ activityId, participantId: participant });
    const p1 = "p1" as ActivityPartId;
    await repos.records.savePartProgress({
      activityRecordId: record.id,
      partId: p1,
      state: { kind: "write_reflection", completed: true, text: "work" },
    });

    await repos.records.reopenAgainstRevision({
      recordId: record.id,
      newRevisionId: null,
      affectedPartIds: [p1],
      reason: "facilitator_reset",
    });
    // Re-save then reset again — a second reset always archives, never deduped.
    await repos.records.savePartProgress({
      activityRecordId: record.id,
      partId: p1,
      state: { kind: "write_reflection", completed: true, text: "work2" },
    });
    await repos.records.reopenAgainstRevision({
      recordId: record.id,
      newRevisionId: null,
      affectedPartIds: [p1],
      reason: "facilitator_reset",
    });

    const history = await repos.records.listPartHistory(record.id);
    expect(history).toHaveLength(2);
    expect(history.every((h) => h.reason === "facilitator_reset")).toBe(true);
    expect(history.every((h) => h.revisionIdAtTime === null)).toBe(true);
    const reset = await repos.records.getPartProgress({ activityRecordId: record.id, partId: p1 });
    expect(reset?.state).toEqual({ kind: "write_reflection", completed: false, text: "" });
  });

  it("listByActivity paginates by id keyset; listByParticipant returns recent-first", async () => {
    const repos = buildRepos();
    const { activityId } = await setup(repos, "page");
    const participants: UserId[] = [];
    for (let i = 0; i < 3; i++) {
      const u = await seedUser(repos.db, `u_page_${i}`, `page_${i}@x.com`);
      participants.push(u);
      await repos.records.upsert({ activityId, participantId: u });
    }

    const first = await repos.records.listByActivity(activityId, { limit: 2 });
    expect(first.records).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await repos.records.listByActivity(activityId, {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.records).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.records, ...second.records].map((r) => r.id);
    expect(new Set(ids).size).toBe(3);

    const byPart = await repos.records.listByParticipant(participants[0] as UserId);
    expect(byPart).toHaveLength(1);
    expect(byPart[0]?.participantId).toBe(participants[0]);
  });

  it("flushEvidenceSignals gates on the killswitch but writes no D1 row in M11; listEvidenceSignals is empty", async () => {
    const repos = buildRepos();
    const { participant, activityId } = await setup(repos, "evidence");

    await repos.records.flushEvidenceSignals([
      {
        activityId,
        participantId: participant,
        partId: "p1" as ActivityPartId,
        signalType: "word_count",
        value: 12,
      },
    ]);

    const rows = await repos.db.select().from(schema.evidenceSignals);
    expect(rows).toHaveLength(0);
    expect(
      await repos.records.listEvidenceSignals({ activityId, participantId: participant }),
    ).toEqual([]);
  });
});
