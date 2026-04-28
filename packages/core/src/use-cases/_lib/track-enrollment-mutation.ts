import {
  DomainError,
  type LearningTrackId,
  type PolicyResult,
  type TrackEnrollment,
  type UserId,
} from "@hearth/domain";
import type { LearningTrackRepository } from "@hearth/ports";

/**
 * Shared shape for the three "authority mutates a target's enrollment"
 * use cases (`removeTrackEnrollment`, `removeTrackFacilitator`). Each
 * loads the target enrollment + the live facilitator count, runs the
 * caller-supplied policy on those values, and maps the deny code to a
 * DomainError. The mutation itself is owned by the call site so the
 * deny code mapping stays in one place but the policy + write each
 * remain colocated with their use case.
 */
export async function loadTargetForEnrollmentMutation(
  tracks: LearningTrackRepository,
  trackId: LearningTrackId,
  target: UserId,
): Promise<{
  readonly targetEnrollment: TrackEnrollment;
  readonly facilitatorCount: number;
}> {
  const [targetEnrollment, facilitatorCount] = await Promise.all([
    tracks.enrollment(trackId, target),
    tracks.countFacilitators(trackId),
  ]);
  if (!targetEnrollment) {
    throw new DomainError("NOT_FOUND", "Enrollment not found.", "not_track_enrollee");
  }
  return { targetEnrollment, facilitatorCount };
}

/**
 * Map a policy deny on a track-mutation use case to the right
 * DomainError. `would_orphan_facilitator` and `group_archived` are
 * `CONFLICT` (the request is well-formed but the live state forbids it);
 * everything else is `FORBIDDEN` (authorization). Returns the verdict so
 * the call site can chain.
 */
export function assertEnrollmentPolicy(verdict: PolicyResult): void {
  if (verdict.ok) return;
  const code =
    verdict.reason.code === "would_orphan_facilitator" || verdict.reason.code === "group_archived"
      ? "CONFLICT"
      : "FORBIDDEN";
  throw new DomainError(code, verdict.reason.message, verdict.reason.code);
}
