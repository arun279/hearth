import { env } from "cloudflare:test";
import * as schema from "@hearth/db/schema";
import type {
  ActivityPartId,
  LearningActivityDraft,
  PartProgressState,
  UserId,
} from "@hearth/domain";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { createActivityRecordRepository } from "../../src/activity-record-repository.ts";
import { createKillswitchGate } from "../../src/killswitch.ts";
import { createLearningActivityRepository } from "../../src/learning-activity-repository.ts";
import { createLearningTrackRepository } from "../../src/learning-track-repository.ts";
import { createLibraryItemRepository } from "../../src/library-item-repository.ts";
import { createStudyGroupRepository } from "../../src/study-group-repository.ts";
import { createSystemFlagRepository } from "../../src/system-flag-repository.ts";

/**
 * Real-D1 integration coverage for the Activity Record adapter — the
 * behavior only deployed-shape SQLite reveals: idempotent record upsert
 * under a race, the part-progress UPSERT + retry-history snapshot, and the
 * load-bearing `reopenAgainstRevision` batch (preserve-then-reset, with
 * `revision_bump` idempotency and a 50-Part transaction).
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
      library: createLibraryItemRepository({ db, gate }),
      activities: createLearningActivityRepository({ db, gate }),
      records: createActivityRecordRepository({ db, gate }),
    };
  }

  type Db = ReturnType<typeof drizzle<typeof schema>>;
  type Repos = ReturnType<typeof buildRepos>;

  async function seedUser(db: Db, suffix: string): Promise<UserId> {
    const now = new Date();
    const id = `u_${suffix}`;
    await db.insert(schema.users).values({
      id,
      email: `${suffix}@x.com`,
      emailVerified: false,
      name: null,
      image: null,
      createdAt: now,
      updatedAt: now,
    });
    return id as UserId;
  }

  async function seedActivity(repos: Repos, suffix: string) {
    const creator = await seedUser(repos.db, suffix);
    const group = await repos.groups.create({ name: "G", createdBy: creator });
    const track = await repos.tracksRepo.create({
      groupId: group.id,
      name: "Track",
      description: null,
      createdBy: creator,
    });
    const draft: LearningActivityDraft = {
      trackId: track.id,
      title: "A",
      description: null,
      parts: [{ kind: "write_reflection", id: "p_reflect", prompt: "Why?" }],
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
    return { creator, group, activity };
  }

  const reflect = (text: string): PartProgressState => ({
    kind: "write_reflection",
    completed: false,
    text,
  });

  it("upsert is idempotent under a concurrent race", async () => {
    const repos = buildRepos();
    const { creator, activity } = await seedActivity(repos, "upsert");
    const now = new Date();
    const [a, b] = await Promise.all([
      repos.records.upsert({ activityId: activity.id, participantId: creator, now }),
      repos.records.upsert({ activityId: activity.id, participantId: creator, now }),
    ]);
    expect(a.id).toBe(b.id);
    const all = await repos.records.listByActivity(activity.id);
    expect(all).toHaveLength(1);
  });

  it("savePartProgress upserts state and round-trips through getPartProgress", async () => {
    const repos = buildRepos();
    const { creator, activity } = await seedActivity(repos, "save");
    const now = new Date();
    const record = await repos.records.upsert({
      activityId: activity.id,
      participantId: creator,
      now,
    });
    const partId = "p_reflect" as ActivityPartId;

    await repos.records.savePartProgress({
      activityRecordId: record.id,
      partId,
      state: reflect("draft one"),
      now,
    });
    let progress = await repos.records.getPartProgress({ activityRecordId: record.id, partId });
    expect(progress?.state).toEqual(reflect("draft one"));

    await repos.records.savePartProgress({
      activityRecordId: record.id,
      partId,
      state: reflect("draft two"),
      now: new Date(),
    });
    progress = await repos.records.getPartProgress({ activityRecordId: record.id, partId });
    expect(progress?.state).toEqual(reflect("draft two"));
    // No retry snapshot was requested, so nothing was preserved.
    expect(await repos.records.countPartHistory(record.id)).toBe(0);
  });

  it("savePartProgress with snapshotPriorAsRetry preserves the prior attempt", async () => {
    const repos = buildRepos();
    const { creator, activity } = await seedActivity(repos, "retry");
    const record = await repos.records.upsert({
      activityId: activity.id,
      participantId: creator,
      now: new Date(),
    });
    const partId = "p_reflect" as ActivityPartId;

    // First submission: no prior, so no history even with the flag set.
    await repos.records.savePartProgress({
      activityRecordId: record.id,
      partId,
      state: reflect("first"),
      now: new Date(),
      snapshotPriorAsRetry: true,
    });
    expect(await repos.records.countPartHistory(record.id)).toBe(0);

    // Re-submission: the prior "first" is snapshotted as a retry.
    await repos.records.savePartProgress({
      activityRecordId: record.id,
      partId,
      state: reflect("second"),
      now: new Date(),
      snapshotPriorAsRetry: true,
    });
    const history = await repos.records.listPartHistory({ activityRecordId: record.id });
    expect(history).toHaveLength(1);
    expect(history[0]?.reason).toBe("retry");
    expect(history[0]?.snapshot).toEqual(reflect("first"));
    const current = await repos.records.getPartProgress({ activityRecordId: record.id, partId });
    expect(current?.state).toEqual(reflect("second"));
  });

  it("setCompletion and setVisibilityOverride round-trip", async () => {
    const repos = buildRepos();
    const { creator, activity } = await seedActivity(repos, "complete");
    const record = await repos.records.upsert({
      activityId: activity.id,
      participantId: creator,
      now: new Date(),
    });
    const at = new Date();
    const completed = await repos.records.setCompletion({ id: record.id, state: "completed", at });
    expect(completed.completionState).toBe("completed");
    expect(completed.completedAt?.getTime()).toBe(at.getTime());

    const reopened = await repos.records.setCompletion({
      id: record.id,
      state: "in_progress",
      at: new Date(),
    });
    expect(reopened.completionState).toBe("in_progress");
    expect(reopened.completedAt).toBeNull();

    const priv = await repos.records.setVisibilityOverride({
      id: record.id,
      override: "private",
      now: new Date(),
    });
    expect(priv.visibilityOverride).toBe("private");
    const cleared = await repos.records.setVisibilityOverride({
      id: record.id,
      override: null,
      now: new Date(),
    });
    expect(cleared.visibilityOverride).toBeNull();
  });

  it("reopenAgainstRevision (facilitator_reset) preserves then resets", async () => {
    const repos = buildRepos();
    const { creator, activity } = await seedActivity(repos, "reset");
    const record = await repos.records.upsert({
      activityId: activity.id,
      participantId: creator,
      now: new Date(),
    });
    const partId = "p_reflect" as ActivityPartId;
    await repos.records.savePartProgress({
      activityRecordId: record.id,
      partId,
      state: { kind: "write_reflection", completed: true, text: "my work" },
      now: new Date(),
    });

    await repos.records.reopenAgainstRevision({
      recordId: record.id,
      reason: "facilitator_reset",
      revisionIdAtTime: null,
      resets: [{ partId, resetState: reflect("") }],
      now: new Date(),
    });

    const history = await repos.records.listPartHistory({ activityRecordId: record.id });
    expect(history).toHaveLength(1);
    expect(history[0]?.reason).toBe("facilitator_reset");
    expect(history[0]?.snapshot).toEqual({
      kind: "write_reflection",
      completed: true,
      text: "my work",
    });
    const reset = await repos.records.getPartProgress({ activityRecordId: record.id, partId });
    expect(reset?.state).toEqual(reflect(""));
  });

  it("reopenAgainstRevision (revision_bump) is idempotent for the same revision", async () => {
    const repos = buildRepos();
    const { creator, group, activity } = await seedActivity(repos, "bump");
    const item = await repos.library.create({
      id: "li_bump" as never,
      groupId: group.id,
      title: "Doc",
      description: null,
      tags: [],
      uploadedBy: creator,
      firstRevision: {
        id: "rev_bump" as never,
        storageKey: `library/${group.id}/li_bump/rev_bump`,
        mimeType: "application/pdf",
        sizeBytes: 1,
        originalFilename: null,
        uploadedBy: creator,
        uploadedAt: new Date(),
      },
      now: new Date(),
    });
    const revisionId = item.revisions[0].id;
    const record = await repos.records.upsert({
      activityId: activity.id,
      participantId: creator,
      now: new Date(),
    });
    const partId = "p_reflect" as ActivityPartId;
    await repos.records.savePartProgress({
      activityRecordId: record.id,
      partId,
      state: reflect("work"),
      now: new Date(),
    });

    const bump = {
      recordId: record.id,
      reason: "revision_bump" as const,
      revisionIdAtTime: revisionId,
      resets: [{ partId, resetState: reflect("") }],
      now: new Date(),
    };
    await repos.records.reopenAgainstRevision(bump);
    await repos.records.reopenAgainstRevision({ ...bump, now: new Date() });

    // Second bump against the same revision is a no-op: still exactly one history row.
    expect(await repos.records.countPartHistory(record.id)).toBe(1);
  });

  it("reopenAgainstRevision reopens a 50-Part record in one transaction", async () => {
    const repos = buildRepos();
    const { creator, activity } = await seedActivity(repos, "fifty");
    const record = await repos.records.upsert({
      activityId: activity.id,
      participantId: creator,
      now: new Date(),
    });

    const partIds = Array.from({ length: 50 }, (_, i) => `p_${i}` as ActivityPartId);
    // D1 caps bound parameters per statement (~100), so seed in chunks
    // rather than one 250-parameter insert. The adapter's reopen batch is
    // unaffected — it issues 102 separate single-row statements.
    for (let start = 0; start < partIds.length; start += 10) {
      await repos.db.insert(schema.partProgress).values(
        partIds.slice(start, start + 10).map((partId, j) => ({
          id: `pp_${start + j}`,
          activityRecordId: record.id,
          partId,
          stateJson: JSON.stringify({ v: 1, data: reflect(`answer ${start + j}`) }),
          updatedAt: new Date(),
        })),
      );
    }

    await repos.records.reopenAgainstRevision({
      recordId: record.id,
      reason: "facilitator_reset",
      revisionIdAtTime: null,
      resets: partIds.map((partId) => ({ partId, resetState: reflect("") })),
      now: new Date(),
    });

    expect(await repos.records.countPartHistory(record.id)).toBe(50);
    const progress = await repos.records.listPartProgress(record.id);
    expect(progress).toHaveLength(50);
    expect(progress.every((p) => p.state.kind === "write_reflection" && p.state.text === "")).toBe(
      true,
    );
  });
});
