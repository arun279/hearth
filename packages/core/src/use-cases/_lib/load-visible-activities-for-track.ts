import {
  computeActivityAccessState,
  type LearningActivityListItem,
  type LearningActivityListRow,
  type LearningTrackId,
  type UserId,
} from "@hearth/domain";
import { canSeeActivity } from "@hearth/domain/policy";
import type {
  Clock,
  InstanceAccessPolicyRepository,
  LearningActivityRepository,
  LearningTrackRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableTrack } from "./load-viewable-track.ts";

export type LoadVisibleActivitiesForTrackDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly tracks: LearningTrackRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly activities: LearningActivityRepository;
  readonly clock: Clock;
};

/**
 * Load the activities on a track that a given actor may actually see.
 *
 * The list endpoint and `/player` MUST agree on visibility — if `/player`
 * would 404 the activity, the list MUST omit it. Skipping that agreement
 * leaks existence: the participant reads a title from the list, clicks,
 * and gets 404 — telling them the activity exists but isn't theirs.
 *
 * Visibility is one decision, sourced from two predicates:
 *
 *   - `canSeeActivity(actor, group, track, audience, …, operator)` — the
 *     same predicate the `/player` route uses. Denies non-members of the
 *     parent group and (for subset audiences) non-listed participants.
 *   - `computeActivityAccessState(window, postClosePolicy, now) !== "hidden"`
 *     — the time-based axis. A post-close `hidden` activity disappears
 *     entirely from the list rather than rendering a row that 404s.
 *
 * Track viewability runs first via `loadViewableTrack`; a non-viewer of
 * the parent group never reaches the per-row check.
 */
export async function loadVisibleActivitiesForTrack(
  actorId: UserId,
  trackId: LearningTrackId,
  deps: LoadVisibleActivitiesForTrackDeps,
): Promise<readonly LearningActivityListItem[]> {
  const ctx = await loadViewableTrack(actorId, trackId, deps);
  const operator = await deps.policy.getOperator(actorId);
  const rows = await deps.activities.byTrack(trackId);
  const now = deps.clock.now();
  const visible = rows.filter((row) => {
    const access = canSeeActivity(
      ctx.actor,
      ctx.group,
      ctx.track,
      row.audience,
      ctx.groupMembership,
      ctx.trackEnrollment,
      operator,
    );
    if (!access.ok) return false;
    const accessState = computeActivityAccessState(row.window, row.postClosePolicy, now);
    return accessState !== "hidden";
  });
  return visible.map(toListItem);
}

/**
 * Project an internal `LearningActivityListRow` to the wire-safe
 * `LearningActivityListItem` by reducing the full `audience` envelope to
 * its `kind` discriminator. This is the boundary that keeps the subset
 * roster (`audience.userIds`) off the wire — every other layer below
 * this point sees the richer Row; the API + SPA see only the Item.
 */
function toListItem(row: LearningActivityListRow): LearningActivityListItem {
  const { audience, ...rest } = row;
  return { ...rest, audienceKind: audience.kind };
}
