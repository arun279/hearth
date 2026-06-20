import type { LearningActivityId, MyActivityRecordView, UserId } from "@hearth/domain";
import type { ActivityRecordRepository } from "@hearth/ports";
import { type LoadOwnRecordDeps, loadOwnRecordContext } from "./_lib/load-own-record-context.ts";

export type GetMyActivityRecordInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
};

export type GetMyActivityRecordDeps = LoadOwnRecordDeps & {
  readonly records: ActivityRecordRepository;
};

/**
 * Read the actor's own Activity Record for the Player to hydrate the
 * interactive Parts. Read-only — it never creates a row (so it stays safe
 * under the killswitch's `read_only` mode); the record is created lazily on
 * the first write. A viewer who isn't a participant gets `canParticipate:
 * false` and an empty part list rather than a 403, so the Player can render
 * the activity read-only.
 */
export async function getMyActivityRecord(
  input: GetMyActivityRecordInput,
  deps: GetMyActivityRecordDeps,
): Promise<MyActivityRecordView> {
  const ctx = await loadOwnRecordContext(input.actor, input.activityId, deps);
  const record = await deps.records.byParticipantAndActivity(input.activityId, input.actor);
  if (!record) {
    return {
      canParticipate: ctx.participation.ok,
      visibilityOverride: null,
      parts: [],
      partHistoryCount: 0,
      partsWithHistory: [],
    };
  }
  const [parts, partHistoryCount, history] = await Promise.all([
    deps.records.listPartProgress(record.id),
    deps.records.countPartHistory(record.id),
    deps.records.listPartHistory(record.id),
  ]);
  return {
    canParticipate: ctx.participation.ok,
    visibilityOverride: record.visibilityOverride,
    parts: parts.map((p) => ({ partId: p.partId, state: p.state })),
    partHistoryCount,
    partsWithHistory: [...new Set(history.map((h) => h.partId))],
  };
}
