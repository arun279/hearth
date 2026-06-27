import type { ActivityRecord } from "./types.ts";

/**
 * One participant's coarse completion fact for a single activity, the unit of
 * the track-altitude progress roster. Carries only existence-and-completion —
 * no part values, reflection prose, or quiz answers. `retryCount` is the
 * count of preserved prior attempts, attached only for an authority viewer;
 * it is `null` for a peer viewer.
 *
 * Same field set as the facilitator roster row (`ActivityParticipantRecordRow`),
 * lifted to track altitude so the same coarse projection backs both the
 * per-activity completion chip and the whole-track roster.
 */
export type TrackProgressRow = {
  readonly recordId: ActivityRecord["id"];
  readonly activityId: ActivityRecord["activityId"];
  readonly participantId: ActivityRecord["participantId"];
  readonly participantDisplayName: string;
  readonly completionState: ActivityRecord["completionState"];
  readonly completedAt: ActivityRecord["completedAt"];
  readonly retryCount: number | null;
};

/**
 * Pure shaper for a {@link TrackProgressRow}. The caller resolves the display
 * name (via the M3 display-name chain) and decides `retryCount` — a number for
 * a facilitator viewer, `null` for a peer — so the facilitator-only retry
 * invariant is enforced at the gated read, never leaked through the projection.
 */
export function projectTrackProgressRow(args: {
  readonly record: ActivityRecord;
  readonly participantDisplayName: string;
  readonly retryCount: number | null;
}): TrackProgressRow {
  const { record, participantDisplayName, retryCount } = args;
  return {
    recordId: record.id,
    activityId: record.activityId,
    participantId: record.participantId,
    participantDisplayName,
    completionState: record.completionState,
    completedAt: record.completedAt,
    retryCount,
  };
}
