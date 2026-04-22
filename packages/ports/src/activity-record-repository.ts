import type {
  ActivityRecordId,
  LearningActivityId,
  LibraryRevisionId,
  UserId,
} from "@hearth/domain";

export interface ActivityRecordRepository {
  byId(id: ActivityRecordId): Promise<unknown | null>;
  byParticipant(userId: UserId): Promise<readonly unknown[]>;
  listByActivity(activityId: LearningActivityId): Promise<readonly unknown[]>;
  reopenAgainstRevision(recordId: ActivityRecordId, revisionId: LibraryRevisionId): Promise<void>;
}
