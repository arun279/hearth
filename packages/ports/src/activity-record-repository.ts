import type {
  ActivityPartId,
  ActivityRecord,
  ActivityRecordId,
  LearningActivityId,
  PartProgress,
  PartProgressState,
  UserId,
  VisibilityPreference,
} from "@hearth/domain";
import type { Write } from "./_brand.ts";

/**
 * Per-(activity, participant) learner state. This is the M10 surface —
 * enough for a participant to author and resume their own work: get-or-
 * create the record, read/write per-Part progress, set the record-level
 * visibility override. Part History, revision-restart, facilitator record
 * views, and the completion rollup layer on in a later milestone; new
 * methods extend this interface without reshaping it.
 */
export interface ActivityRecordRepository {
  /** Get-or-create the record for (activity, participant). Idempotent. */
  upsert: Write<
    (args: { activityId: LearningActivityId; participantId: UserId }) => Promise<ActivityRecord>
  >;
  byParticipantAndActivity(
    activityId: LearningActivityId,
    participantId: UserId,
  ): Promise<ActivityRecord | null>;
  setVisibilityOverride: Write<
    (id: ActivityRecordId, override: VisibilityPreference | null) => Promise<void>
  >;
  getPartProgress(args: {
    activityRecordId: ActivityRecordId;
    partId: ActivityPartId;
  }): Promise<PartProgress | null>;
  listPartProgress(activityRecordId: ActivityRecordId): Promise<readonly PartProgress[]>;
  savePartProgress: Write<
    (args: {
      activityRecordId: ActivityRecordId;
      partId: ActivityPartId;
      state: PartProgressState;
    }) => Promise<void>
  >;
}
