import type {
  ContributionPolicyEnvelope,
  LearningTrack,
  LearningTrackId,
  StudyGroupId,
  TrackEnrollment,
  TrackStatus,
  TrackStructureEnvelope,
  UserId,
} from "@hearth/domain";

/**
 * Patch shape for `updateMetadata`. Either field may be present and `null`
 * is the explicit "clear" signal for `description`. Empty patches are
 * caller-validated.
 */
export type LearningTrackMetadataPatch = {
  readonly name?: string;
  readonly description?: string | null;
};

/**
 * Aggregated counts for a track's home tabs. Each count must hit an indexed
 * column so the call stays a small, bounded set of `count(*)` reads. Until
 * M8 / M13 / M6 / M15 land, every count returns 0 — the field shape is
 * fixed early so the SPA's track-home contract doesn't shift between
 * milestones.
 */
export type LearningTrackSummaryCounts = {
  readonly activityCount: number;
  readonly sessionCount: number;
  readonly libraryItemCount: number;
  readonly pendingContributionCount: number;
  readonly facilitatorCount: number;
  readonly enrollmentCount: number;
};

export interface LearningTrackRepository {
  /**
   * Atomically inserts the `tracks` row + the creator's first facilitator
   * `track_enrollments` row in a single D1 batch. The orphan-facilitator
   * invariant ("an active track keeps ≥ 1 facilitator") is satisfied at
   * commit time. Initial structure / contribution policy default to
   * `EMPTY_TRACK_STRUCTURE` / `DEFAULT_CONTRIBUTION_POLICY` if the caller
   * omits them.
   */
  create(input: {
    readonly groupId: StudyGroupId;
    readonly name: string;
    readonly description: string | null;
    readonly createdBy: UserId;
    readonly structure?: TrackStructureEnvelope;
    readonly contributionPolicy?: ContributionPolicyEnvelope;
  }): Promise<LearningTrack>;

  byId(id: LearningTrackId): Promise<LearningTrack | null>;

  byGroup(
    groupId: StudyGroupId,
    opts?: { readonly status?: TrackStatus },
  ): Promise<readonly LearningTrack[]>;

  /**
   * Conditional UPDATE: only succeeds if the row's status is still in the
   * caller's `expectedFromStatus`. Writes `pausedAt` / `archivedAt` /
   * `archivedBy` atomically with the new status. Throws CONFLICT
   * `track_status_changed` if a concurrent flip stole the transition. No-op
   * (no throw) when the row is already at `to`.
   */
  updateStatus(input: {
    readonly id: LearningTrackId;
    readonly to: TrackStatus;
    readonly expectedFromStatus: TrackStatus;
    readonly by: UserId;
  }): Promise<LearningTrack>;

  /**
   * Edit name and/or description. Throws CONFLICT `track_archived` if the
   * row is archived at write time, even when the `byId` snapshot the use
   * case fed in was active.
   */
  updateMetadata(
    id: LearningTrackId,
    patch: LearningTrackMetadataPatch,
    by: UserId,
  ): Promise<LearningTrack>;

  /**
   * Replace the track-structure envelope. The repository re-parses through
   * the domain Zod schema before persisting (defense in depth) so a caller
   * that bypasses the use case still cannot persist a malformed envelope.
   */
  saveStructure(
    id: LearningTrackId,
    envelope: TrackStructureEnvelope,
    by: UserId,
  ): Promise<LearningTrack>;

  /**
   * Replace the contribution-policy envelope. Same defense-in-depth parse as
   * `saveStructure`.
   */
  saveContributionPolicy(
    id: LearningTrackId,
    envelope: ContributionPolicyEnvelope,
    by: UserId,
  ): Promise<LearningTrack>;

  /**
   * Read the persisted envelopes (already validated through the domain Zod
   * schemas at read time). Separate from `byId` so a list page that only
   * needs name + status doesn't pay the JSON parse cost on every row.
   */
  loadStructure(id: LearningTrackId): Promise<TrackStructureEnvelope | null>;
  loadContributionPolicy(id: LearningTrackId): Promise<ContributionPolicyEnvelope | null>;

  // ── Enrollment surface (M5 owns the deep enrollment flow) ──────────────
  // M4 only needs the four read methods below + endAllEnrollmentsForUser
  // (cascade contract called by group-membership removal). The full enroll/
  // unenroll/listEnrollments pair lands in M5.

  enrollment(trackId: LearningTrackId, userId: UserId): Promise<TrackEnrollment | null>;
  listFacilitators(trackId: LearningTrackId): Promise<readonly TrackEnrollment[]>;
  countFacilitators(trackId: LearningTrackId): Promise<number>;
  countEnrollments(trackId: LearningTrackId): Promise<number>;

  /**
   * Cascade contract: when a Group Membership is removed, every active
   * enrollment that user holds on tracks belonging to that group must be
   * ended in the same transaction. The implementation is a guarded UPDATE
   * the membership-removal use case calls after the membership row is
   * removed.
   *
   * Returns the number of enrollments that were ended.
   */
  endAllEnrollmentsForUser(input: {
    readonly groupId: StudyGroupId;
    readonly userId: UserId;
    readonly by: UserId;
  }): Promise<number>;
}
