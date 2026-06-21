import type { ActivityPlayerProjection, LearningActivity } from "@hearth/domain";
import { Badge, cn } from "@hearth/ui";
import type { ReactNode } from "react";
import type { PartMeasure } from "./_lib/part-measure.ts";

type Props = {
  readonly activity: LearningActivity;
  readonly accessState: ActivityPlayerProjection["accessState"];
  readonly currentPartIndex: number;
  readonly totalParts: number;
  readonly completedCount: number;
  /**
   * True once the participant's own activity record is `completed`. Renders a
   * "Completed" badge in the title row so the closed state is recognisable at a
   * glance and rehydrates across a reload (not just inferred from the footer).
   */
  readonly activityCompleted?: boolean;
  /**
   * Total prior attempts preserved across every Part of the participant's own
   * record (`partHistoryCount`). Renders the "N prior attempts preserved" chip
   * only when non-zero — its presence reassures the learner that a reset or
   * revision bump never destroyed earlier work.
   */
  readonly priorAttemptsCount?: number;
  /**
   * Authority-only action (the facilitator participant-roster trigger), pushed
   * to the right of the status row so it sits where a facilitator already looks
   * for activity-level controls rather than in a dedicated band.
   */
  readonly facilitatorAction?: ReactNode;
  /**
   * The active Part's content measure (`partMeasure(activePart)`). The header
   * shares the body's measure so the two columns are always the same width and
   * share a left edge across every Part kind — text (672) and media (768)
   * alike. The header takes no rail offset of its own: it sits inside the same
   * post-rail flex column as the body, so the 240px rail produces the offset
   * structurally rather than via a hand-synced literal.
   */
  readonly measure: PartMeasure;
};

/**
 * Title strip above the player body. Mirrors the prototype's calm-text
 * hierarchy:
 *
 *   - Big serif title (the activity name).
 *   - Optional description in muted body text.
 *   - Status row: an access-state badge (only when non-`open`), the
 *     monospace "Part X of N" counter, a completion track, and a
 *     visible "N of M Parts complete" count.
 *
 * The completion track fills to the share of honor-system-completed Parts,
 * driven by the participant's own record. `aria-valuetext` carries the same
 * "N of M" count a sighted user reads so the bar is not a bare percentage to
 * assistive tech.
 */
export function ActivityHeader({
  activity,
  accessState,
  currentPartIndex,
  totalParts,
  completedCount,
  activityCompleted = false,
  priorAttemptsCount = 0,
  facilitatorAction,
  measure,
}: Props) {
  const denominator = Math.max(totalParts, 1);
  const completionPercent = Math.round((completedCount / denominator) * 100);
  const completionText = `${completedCount} of ${totalParts} Parts complete`;
  const stateBadge = ACCESS_STATE_BADGES[accessState];

  return (
    <header className="shrink-0 border-[var(--color-rule)] border-b px-5 py-5 md:px-8 md:py-7">
      <div className={cn("mx-auto w-full space-y-3", measure)}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-serif text-[28px] text-[var(--color-ink)] leading-tight">
            {activity.title}
          </h1>
          {activityCompleted ? <Badge tone="good">Completed</Badge> : null}
          {stateBadge ? <Badge tone={stateBadge.tone}>{stateBadge.label}</Badge> : null}
        </div>
        {activity.description ? (
          <p className="text-[13px] text-[var(--color-ink-2)] leading-relaxed">
            {activity.description}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-mono text-[11px] text-[var(--color-ink-2)] tabular-nums">
            Part {Math.min(currentPartIndex + 1, denominator)} of {denominator}
          </span>
          <div
            className="h-[5px] min-w-[80px] max-w-[280px] flex-1 overflow-hidden rounded-full bg-[var(--color-rule-strong)]"
            role="progressbar"
            aria-label="Activity completion"
            aria-valuenow={completionPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={completionText}
          >
            <div
              className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-200"
              style={{ width: `${completionPercent}%` }}
            />
          </div>
          <span className="text-[11px] text-[var(--color-ink-2)] tabular-nums">
            {completionText}
          </span>
          {priorAttemptsCount > 0 ? (
            <Badge tone="neutral">
              {priorAttemptsCount} prior {priorAttemptsCount === 1 ? "attempt" : "attempts"}{" "}
              preserved
            </Badge>
          ) : null}
          {facilitatorAction ? <div className="ms-auto">{facilitatorAction}</div> : null}
        </div>
      </div>
    </header>
  );
}

const ACCESS_STATE_BADGES: Record<
  ActivityPlayerProjection["accessState"],
  { tone: "neutral" | "good" | "warn" | "danger" | "accent"; label: string } | null
> = {
  open: null,
  pre_open: { tone: "neutral", label: "Not yet open" },
  locked: { tone: "warn", label: "Closed" },
  // `hidden` is handled at the route level (rendered as a not-found
  // state). Listing it as `null` here keeps the discriminator exhaustive
  // without committing visual treatment that can never be reached.
  hidden: null,
};
