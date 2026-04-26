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

  /**
   * Cascade contract: when a Group Membership is removed, every active
   * enrollment that user holds on tracks belonging to that group must be
   * ended too. The implementation is a guarded UPDATE the use case calls
   * after the membership row is removed; M3 ships a no-op fallback because
   * no enrollments exist yet, but the contract is locked in here so the
   * remove-member orchestration can call into it unconditionally.
   *
   * Returns the number of enrollments that were actually ended (0 in M3).
   */
  endAllEnrollmentsForUser(input: {
    groupId: StudyGroupId;
    userId: UserId;
    by: UserId;
  }): Promise<number>;
}
