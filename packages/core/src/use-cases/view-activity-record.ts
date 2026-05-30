import { type ActivityRecordId, DomainError, type UserId } from "@hearth/domain";
import { type ActivityRecordScope, canViewActivityRecord } from "@hearth/domain/policy";
import type {
  ActivityRecordRepository,
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableActivity } from "./_lib/load-viewable-activity.ts";
import { type ActivityRecordView, loadRecordView } from "./_lib/record-view.ts";

export type ViewActivityRecordInput = {
  readonly actor: UserId;
  readonly recordId: ActivityRecordId;
};

export type ViewActivityRecordDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly activities: LearningActivityRepository;
  readonly records: ActivityRecordRepository;
};

export type ViewActivityRecordResult = ActivityRecordView & {
  readonly scope: ActivityRecordScope;
};

/**
 * Read one Activity Record at the detail level the viewer is entitled to.
 * The participant sees their own work; an Instance Operator and any Track
 * authority (Group Admin or Track Facilitator) also see full detail. A
 * viewer who is denied — or who can't even see the parent activity — gets
 * the same `NOT_FOUND` a missing record returns, leaking nothing.
 */
export async function viewActivityRecord(
  input: ViewActivityRecordInput,
  deps: ViewActivityRecordDeps,
): Promise<ViewActivityRecordResult> {
  const record = await deps.records.byId(input.recordId);
  if (!record) {
    throw new DomainError("NOT_FOUND", "Record not found.", "record_not_found");
  }

  const ctx = await loadViewableActivity(input.actor, record.activityId, deps);
  const operator = await deps.policy.getOperator(input.actor);

  const verdict = canViewActivityRecord(
    ctx.actor,
    record,
    ctx.track,
    ctx.groupMembership,
    ctx.trackEnrollment,
    operator,
  );
  if (!verdict.ok) {
    throw new DomainError("NOT_FOUND", "Record not found.", "record_not_found");
  }

  const view = await loadRecordView(record, deps.records);
  return { ...view, scope: verdict.scope };
}
