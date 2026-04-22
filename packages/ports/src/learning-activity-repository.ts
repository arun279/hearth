import type { LearningActivityId, LearningTrackId, UserId } from "@hearth/domain";

export interface LearningActivityRepository {
  byId(id: LearningActivityId): Promise<unknown | null>;
  byTrack(trackId: LearningTrackId): Promise<readonly unknown[]>;
  resetParticipantProgress(activityId: LearningActivityId, by: UserId): Promise<void>;
}
