import {
  type ActivityPart,
  DomainError,
  type LearningActivityId,
  type PolicyResult,
  type UserId,
} from "@hearth/domain";
import { canRecordOwnActivityProgress, canSeeActivity } from "@hearth/domain/policy";
import type { Clock } from "@hearth/ports";
import { assertActivityWritable } from "./assert-activity-writable.ts";
import {
  type LoadViewableActivityDeps,
  loadViewableActivity,
  type ViewableActivityContext,
} from "./load-viewable-activity.ts";

export type OwnRecordContext = ViewableActivityContext & {
  /**
   * Whether the actor may author state for this activity. Carried (rather
   * than asserted) so read paths can surface it as a flag while write paths
   * call `assertParticipant`.
   */
  readonly participation: PolicyResult;
};

export type LoadOwnRecordDeps = LoadViewableActivityDeps;

/**
 * Load the caller-context bundle for a participant operating on their own
 * Activity Record. Two gates, in the order the existence-leak rule requires:
 *
 *   1. `canSeeActivity` — a viewer who isn't in the audience gets the same
 *      `NOT_FOUND` a stranger does (subset rosters never leak via 403-vs-404).
 *   2. `canRecordOwnActivityProgress` — computed and returned, NOT thrown, so
 *      `get-my-activity-record` can report read-only viewers while the write
 *      use cases reject them via `assertParticipant`.
 */
export async function loadOwnRecordContext(
  actorId: UserId,
  activityId: LearningActivityId,
  deps: LoadOwnRecordDeps,
): Promise<OwnRecordContext> {
  const ctx = await loadViewableActivity(actorId, activityId, deps);
  const operator = await deps.policy.getOperator(actorId);
  const see = canSeeActivity(
    ctx.actor,
    ctx.group,
    ctx.track,
    ctx.activity.audience,
    ctx.groupMembership,
    ctx.trackEnrollment,
    operator,
  );
  if (!see.ok) {
    throw new DomainError("NOT_FOUND", "Activity not found.", "not_found");
  }
  const participation = canRecordOwnActivityProgress(
    ctx.actor,
    ctx.track,
    ctx.activity.audience,
    ctx.trackEnrollment,
  );
  return { ...ctx, participation };
}

/**
 * Reject a non-participant write with the policy's specific denial
 * (`not_track_enrollee` / `not_in_audience`) as a 403 — the activity is
 * already acknowledged as visible by the `canSeeActivity` gate, so this is
 * an honest authorization failure, not an existence leak.
 */
export function assertParticipant(ctx: OwnRecordContext): void {
  if (!ctx.participation.ok) {
    throw new DomainError(
      "FORBIDDEN",
      ctx.participation.reason.message,
      ctx.participation.reason.code,
    );
  }
}

export type LoadWritableOwnPartDeps = LoadOwnRecordDeps & { readonly clock: Clock };

/**
 * Shared prologue for the own-record *write* use cases (reflection autosave,
 * quiz submit): authorize the actor as a participant, gate on the activity's
 * write window, then locate the addressed Part and assert its kind. Returns
 * the Part narrowed to the requested kind so the caller works with a typed
 * variant. Visibility-override writes deliberately do NOT route through here —
 * privacy stays adjustable after close, so they skip `assertActivityWritable`.
 */
export async function loadWritableOwnPart<K extends ActivityPart["kind"]>(
  input: {
    readonly actor: UserId;
    readonly activityId: LearningActivityId;
    readonly partId: string;
  },
  kind: K,
  deps: LoadWritableOwnPartDeps,
): Promise<Extract<ActivityPart, { readonly kind: K }>> {
  const ctx = await loadOwnRecordContext(input.actor, input.activityId, deps);
  assertParticipant(ctx);
  assertActivityWritable(ctx.activity, deps.clock.now());

  const part = ctx.activity.parts.find((p) => p.id === input.partId);
  if (!part) {
    throw new DomainError("NOT_FOUND", "Part not found.", "not_found");
  }
  if (part.kind !== kind) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Part is not a ${kind} Part.`,
      "part_kind_mismatch",
    );
  }
  // The runtime guard above proves the discriminant; TS can't narrow on a
  // generic `K`, so this localized cast carries that proof to the type level.
  return part as Extract<ActivityPart, { readonly kind: K }>;
}
