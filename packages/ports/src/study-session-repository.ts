import type { LearningTrackId, StudySessionId, UserId } from "@hearth/domain";

export interface StudySessionRepository {
  byId(id: StudySessionId): Promise<unknown | null>;
  byTrack(trackId: LearningTrackId): Promise<readonly unknown[]>;
  recordAttendance(sessionId: StudySessionId, userId: UserId): Promise<void>;
  removeAttendance(sessionId: StudySessionId, userId: UserId): Promise<void>;
}
