import type {
  LearningTrack,
  LearningTrackId,
  StudyGroupId,
  TrackEnrollment,
  TrackStatus,
  UserId,
} from "@hearth/domain";

export interface LearningTrackRepository {
  create(input: {
    groupId: StudyGroupId;
    name: string;
    description?: string;
  }): Promise<LearningTrack>;
  byId(id: LearningTrackId): Promise<LearningTrack | null>;
  byGroup(groupId: StudyGroupId): Promise<readonly LearningTrack[]>;
  updateStatus(id: LearningTrackId, status: TrackStatus, by: UserId): Promise<void>;

  enroll(trackId: LearningTrackId, userId: UserId): Promise<TrackEnrollment>;
  unenroll(trackId: LearningTrackId, userId: UserId, by: UserId): Promise<void>;
  listEnrollments(trackId: LearningTrackId): Promise<readonly TrackEnrollment[]>;
  enrollment(trackId: LearningTrackId, userId: UserId): Promise<TrackEnrollment | null>;
  listFacilitators(trackId: LearningTrackId): Promise<readonly TrackEnrollment[]>;
  countFacilitators(trackId: LearningTrackId): Promise<number>;
}
