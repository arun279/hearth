import type {
  ContributionPolicyEnvelope,
  LearningTrack,
  LearningTrackId,
  StudyGroupId,
  TrackEnrollment,
  TrackRole,
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
   * Replace the track-structure envelope. The repository re-parses the
   * envelope structurally before persisting (defense in depth) so a
   * caller that bypasses the use case still cannot persist a malformed
   * envelope. Implementations are free to use any validation mechanism
   * (the cloudflare adapter hand-rolls one because zod isn't on its
   * allowed-deps list); the contract is that a malformed envelope
   * surfaces as a thrown Error rather than a silent write.
   */
  saveStructure(
    id: LearningTrackId,
    envelope: TrackStructureEnvelope,
    by: UserId,
  ): Promise<LearningTrack>;

  /**
   * Replace the contribution-policy envelope. Same defense-in-depth
   * structural re-parse as `saveStructure`.
   */
  saveContributionPolicy(
    id: LearningTrackId,
    envelope: ContributionPolicyEnvelope,
    by: UserId,
  ): Promise<LearningTrack>;

  /**
   * Read the persisted envelopes (re-validated structurally on read so a
   * malformed JSON column surfaces loudly rather than as a silent type
   * cast). Separate from `byId` so a list page that only needs name +
   * status doesn't pay the JSON parse cost on every row.
   */
  loadStructure(id: LearningTrackId): Promise<TrackStructureEnvelope | null>;
  loadContributionPolicy(id: LearningTrackId): Promise<ContributionPolicyEnvelope | null>;

  // ── Enrollment surface ─────────────────────────────────────────────────

  enrollment(trackId: LearningTrackId, userId: UserId): Promise<TrackEnrollment | null>;
  listFacilitators(trackId: LearningTrackId): Promise<readonly TrackEnrollment[]>;
  countFacilitators(trackId: LearningTrackId): Promise<number>;
  countEnrollments(trackId: LearningTrackId): Promise<number>;

  /**
   * The actor's currently-active enrollments. Excludes left rows. Powers
   * the `/api/v1/me/context` envelope; one indexed read per call.
   */
  enrollmentsForUser(userId: UserId): Promise<readonly TrackEnrollment[]>;

  /**
   * Active (and optionally historical) enrollments on a track, ordered
   * by `enrolledAt` for a stable People-tab list. `includeLeft` toggles
   * whether the historic section is materialized — the SPA gates that
   * section to authority viewers.
   */
  listEnrollments(
    trackId: LearningTrackId,
    opts: { readonly includeLeft: boolean },
  ): Promise<readonly TrackEnrollment[]>;

  /**
   * Begin (or revive) an enrollment. UPSERT semantics on the
   * `(trackId, userId)` UNIQUE index:
   *  - no existing row → INSERT a new participant row
   *  - existing row with `leftAt !== null` → UPDATE clearing `leftAt` /
   *    `leftBy`, resetting `enrolledAt`, role unchanged
   *  - existing row with `leftAt === null` → idempotent no-op (returns
   *    the existing row)
   *
   * The implementation guards membership existence (the target must hold
   * a current Group Membership in the track's group) inside the same D1
   * batch so a concurrent membership removal cannot land an orphan
   * enrollment. Throws `DomainError("FORBIDDEN", …, "enrollment_requires_membership")`
   * when no current membership row exists at write time.
   */
  enroll(input: {
    readonly trackId: LearningTrackId;
    readonly userId: UserId;
    readonly by: UserId;
  }): Promise<TrackEnrollment>;

  /**
   * End an active enrollment (`leftAt = now`, `leftBy = by`). The orphan
   * check runs inside a single conditional UPDATE: if the target is the
   * only active facilitator on an active track, the UPDATE matches zero
   * rows and the implementation throws `DomainError("CONFLICT", …,
   * "would_orphan_facilitator")`. Already-left rows are an idempotent
   * no-op — the caller receives the existing row unchanged.
   *
   * Paused / archived tracks bypass the orphan guard so a frozen track
   * can drop to zero facilitators (mirrors `wouldOrphanAdmin`'s
   * archived-group carve-out).
   */
  unenroll(input: {
    readonly trackId: LearningTrackId;
    readonly userId: UserId;
    readonly by: UserId;
  }): Promise<TrackEnrollment>;

  /**
   * Promote (`participant → facilitator`) or demote (`facilitator →
   * participant`). Demotion runs the same orphan check as `unenroll`;
   * promotion verifies the target has a current enrollment at write time.
   * Throws `DomainError("FORBIDDEN", …, "not_track_enrollee")` for a
   * stale promote, or `CONFLICT would_orphan_facilitator` for an unsafe
   * demote.
   *
   * Same-role calls are an idempotent no-op (return the existing row).
   */
  setEnrollmentRole(input: {
    readonly trackId: LearningTrackId;
    readonly userId: UserId;
    readonly role: TrackRole;
    readonly by: UserId;
  }): Promise<TrackEnrollment>;

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

  /**
   * For each active track in `groupId`: detect tracks where `userId` is
   * the only remaining active facilitator. Used by `removeGroupMember` /
   * `leaveGroup` to refuse a removal that would silently orphan tracks
   * via the cascade. Returns the offending tracks so the SPA can show
   * "promote a replacement on these tracks first."
   *
   * Single indexed read joining `tracks` and `track_enrollments`; runs
   * before the membership write so a refusal does not leave the system
   * in a partial state.
   */
  findTracksOrphanedByMemberRemoval(input: {
    readonly groupId: StudyGroupId;
    readonly userId: UserId;
  }): Promise<readonly { readonly trackId: LearningTrackId; readonly trackName: string }[]>;
}
