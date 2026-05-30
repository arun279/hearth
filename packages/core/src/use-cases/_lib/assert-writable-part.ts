import {
  type ActivityPartId,
  type ActivityRecord,
  arePartPrerequisitesMet,
  computeActivityAccessState,
  DomainError,
  type PartProgress,
  type UserId,
} from "@hearth/domain";
import { canMarkPartComplete } from "@hearth/domain/policy/can-mark-part-complete";
import type { ActivityRecordRepository, Clock } from "@hearth/ports";
import type { ViewableActivityContext } from "./load-viewable-activity.ts";

export type WritablePartGate = {
  readonly record: ActivityRecord;
  readonly now: Date;
  readonly priorProgress: readonly PartProgress[];
  /** Completed Part ids other than the one being written — used for the auto-complete rollup. */
  readonly completedOtherPartIds: ReadonlySet<string>;
};

/**
 * Open the participant's own record and assert they may write the given Part
 * right now: same ownership / open-window / met-prerequisite gate the player
 * shows, re-checked server-side so a non-route caller can't forge a write past
 * a locked window or an unmet prereq. Shared by every per-Part write use case
 * (reflection save, quiz submit, completion flip) so the gate can't drift
 * between them. The caller resolves the Part (and any kind check) first; this
 * only handles the record + authorization.
 */
export async function assertWritablePart(
  ctx: ViewableActivityContext,
  actor: UserId,
  partId: ActivityPartId,
  deps: { readonly records: ActivityRecordRepository; readonly clock: Clock },
): Promise<WritablePartGate> {
  const now = deps.clock.now();
  const record = await deps.records.upsert({
    activityId: ctx.activity.id,
    participantId: actor,
    now,
  });

  const priorProgress = await deps.records.listPartProgress(record.id);
  const completedOtherPartIds = new Set<string>(
    priorProgress.filter((p) => p.partId !== partId && p.state.completed).map((p) => p.partId),
  );
  const prerequisitesMet = arePartPrerequisitesMet(
    ctx.activity.flow,
    partId,
    completedOtherPartIds,
  );
  const accessState = computeActivityAccessState(
    ctx.activity.window,
    ctx.activity.postClosePolicy,
    now,
  );

  const verdict = canMarkPartComplete(ctx.actor, record, accessState, prerequisitesMet);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  return { record, now, priorProgress, completedOtherPartIds };
}
