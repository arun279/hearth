import type { GroupMembership, StudyGroup } from "../group.ts";
import { isCurrentEnrollment, isCurrentMember } from "../policy/helpers.ts";
import type { ActivityRecord } from "../record/types.ts";
import type { LearningTrack, TrackEnrollment } from "../track.ts";
import type { User } from "../user.ts";
import type { VisibilityPreference, VisibilityScope } from "./preference.ts";

/**
 * The scope a current *track participant-enrollee* resolves for a peer's
 * record, keyed by the peer's effective preference. A co-enrollee shares the
 * learning context, so `default`/`track_only` both grant `full`; only an
 * explicit `private` redacts down to `summary`.
 */
const TRACK_ENROLLEE_SCOPE = {
  default: "full",
  track_only: "full",
  private: "summary",
} as const satisfies Record<VisibilityPreference, VisibilityScope>;

/**
 * The scope a current group member who is *not* in the record's track
 * resolves, keyed by effective preference. Outside the track context only an
 * unqualified `default` leaks a `summary`; `track_only` and `private` both
 * hide entirely.
 */
const GROUP_MEMBER_SCOPE = {
  default: "summary",
  track_only: "hidden",
  private: "hidden",
} as const satisfies Record<VisibilityPreference, VisibilityScope>;

/**
 * Resolve the observable {@link VisibilityScope} a `viewer` has on another
 * participant's Activity Record. Pure and synchronous (SPA-importable): the
 * caller supplies the already-loaded viewer membership/enrollment, the
 * record's group/track context, and the participant's resolved default
 * preference; this function only branches.
 *
 * Composition is separate from access (ADR 0007): the use case runs the
 * `canViewActivityRecord` policy gate first (deny -> 404), then this
 * resolver; a `hidden` result also funnels to a byte-identical 404.
 *
 * Branch order is load-bearing and mirrors the Visibility Scope spec exactly:
 *   1. the participant always sees their own record in `full`;
 *   2. a non-current member of the record's group sees nothing (`hidden`);
 *   3. a current Track Facilitator always sees `full` (curation duty);
 *   4. the effective preference is the per-record override, else the
 *      participant's default;
 *   5. the viewer-context table maps the effective preference to a scope.
 *
 * The effective-preference line reads `record.visibilityOverride` — the
 * already-parsed `VisibilityPreference | null` on the domain type — rather
 * than the raw envelope the spec pseudocode dereferences; the adapter
 * pre-parses the JSON column, so the domain never sees the envelope.
 */
export function resolveActivityRecordScope(args: {
  readonly record: ActivityRecord;
  readonly viewer: User;
  readonly groupId: StudyGroup["id"];
  readonly trackId: LearningTrack["id"];
  readonly viewerMembership: GroupMembership | null;
  readonly viewerEnrollment: TrackEnrollment | null;
  readonly participantPreference: VisibilityPreference;
}): VisibilityScope {
  if (args.viewer.id === args.record.participantId) return "full";

  if (!isCurrentMember(args.viewerMembership, args.groupId)) return "hidden";

  if (
    args.viewerEnrollment?.role === "facilitator" &&
    isCurrentEnrollment(args.viewerEnrollment, args.trackId)
  ) {
    return "full";
  }

  const effective: VisibilityPreference =
    args.record.visibilityOverride ?? args.participantPreference;

  const isTrackEnrollee =
    isCurrentEnrollment(args.viewerEnrollment, args.trackId) &&
    args.viewerEnrollment?.role === "participant";
  if (isTrackEnrollee) {
    return TRACK_ENROLLEE_SCOPE[effective];
  }
  return GROUP_MEMBER_SCOPE[effective];
}
