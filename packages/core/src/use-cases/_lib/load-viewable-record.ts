import {
  type ActivityRecord,
  type ActivityRecordId,
  DomainError,
  type GroupMembership,
  type LearningTrackId,
  resolveActivityRecordScope,
  type StudyGroupId,
  type User,
  type UserId,
  type VisibilityScope,
} from "@hearth/domain";
import { canViewActivityRecord } from "@hearth/domain/policy/record";
import type {
  ActivityRecordRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";

export type LoadViewableRecordDeps = {
  readonly users: UserRepository;
  readonly records: ActivityRecordRepository;
  readonly activities: LearningActivityRepository;
  readonly tracks: LearningTrackRepository;
  readonly groups: StudyGroupRepository;
};

export type ViewableRecordContext = {
  readonly actor: User;
  readonly record: ActivityRecord;
  readonly groupId: StudyGroupId;
  readonly trackId: LearningTrackId;
  /**
   * The detail the actor may observe. Never `"hidden"`: a hidden resolution
   * throws `NOT_FOUND` inside this loader, so consumers only branch on
   * `"full"` vs `"summary"`.
   */
  readonly scope: Exclude<VisibilityScope, "hidden">;
  /** The record's participant — `null` only if the user row has gone. */
  readonly participant: User | null;
  readonly participantMembership: GroupMembership | null;
};

const notFound = () => new DomainError("NOT_FOUND", "Record not found.", "not_found");

/**
 * Shared prologue for the cross-participant record reads (the full/summary
 * projection and the part-history list). Loads the record's group/track
 * context and the actor's membership/enrollment, then composes access and
 * detail as two separated concerns in order:
 *
 *   1. `canViewActivityRecord` — the access gate. A denial is surfaced as
 *      `NOT_FOUND` (404), never 403, so a non-member probing a record id
 *      cannot tell "exists but forbidden" from "does not exist".
 *   2. `resolveActivityRecordScope` — the detail. A `hidden` resolution is a
 *      byte-identical 404; otherwise the resolved `full`/`summary` scope is
 *      returned for the consumer to project against.
 *
 * Centralising both reads here is the enumeration-oracle guard: the record
 * read and its part-history sibling MUST resolve the SAME scope, or a viewer
 * who is redacted to `summary` (or hidden) on the record could still pull the
 * unredacted history through the sibling endpoint.
 */
export async function loadViewableRecord(
  actorId: UserId,
  recordId: ActivityRecordId,
  deps: LoadViewableRecordDeps,
): Promise<ViewableRecordContext> {
  const actor = await deps.users.byId(actorId);
  if (!actor) throw notFound();
  const record = await deps.records.byId(recordId);
  if (!record) throw notFound();

  const activity = await deps.activities.byId(record.activityId);
  if (!activity) throw notFound();
  const track = await deps.tracks.byId(activity.trackId);
  if (!track) throw notFound();
  // Guard against a port-fake returning a row whose ids don't line up with
  // what an indexed lookup would have keyed against — mirrors the same
  // collapse-to-NOT_FOUND defense in `loadViewableActivity`.
  if (activity.trackId !== track.id) throw notFound();

  const { groupId } = track;
  const trackId = track.id;

  const viewerMembership = await deps.groups.membership(groupId, actor.id);
  if (!canViewActivityRecord(actor, record, viewerMembership, groupId).ok) {
    throw notFound();
  }

  const [viewerEnrollment, participant, participantMembership] = await Promise.all([
    deps.tracks.enrollment(trackId, actor.id),
    deps.users.byId(record.participantId),
    deps.groups.membership(groupId, record.participantId),
  ]);

  const scope = resolveActivityRecordScope({
    record,
    viewer: actor,
    groupId,
    trackId,
    viewerMembership,
    viewerEnrollment,
    participantPreference: participant?.visibilityPreference ?? "default",
  });
  if (scope === "hidden") throw notFound();

  return { actor, record, groupId, trackId, scope, participant, participantMembership };
}
