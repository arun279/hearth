import type { ActivityPlayerProjection, LearningActivity } from "@hearth/domain";
import { Badge, Button } from "@hearth/ui";

type Props = {
  readonly activity: LearningActivity;
  readonly accessState: ActivityPlayerProjection["accessState"];
  readonly currentPartIndex: number;
  readonly totalParts: number;
  readonly completedCount: number;
  readonly isComplete: boolean;
  /** True only for `manual_mark` activities the participant can still complete. */
  readonly canMarkComplete: boolean;
  readonly onMarkComplete: () => void;
  readonly markCompletePending: boolean;
};

/**
 * Title strip above the player body. Mirrors the prototype's calm-text
 * hierarchy: a big serif title, an optional muted description, then a status
 * row carrying the access / completion badge, the monospace "Part X of N"
 * cursor, a real completion track ("done / total"), and — for `manual_mark`
 * activities — the participant's "Mark activity complete" action.
 *
 * The completion track reflects how many Parts carry a completed Part Progress
 * row, not cursor position; `all_parts_complete` activities roll up to complete
 * automatically when the last Part lands, so they show the "Complete" badge
 * without a button, while `manual_mark` activities surface the explicit action.
 */
export function ActivityHeader({
  activity,
  accessState,
  currentPartIndex,
  totalParts,
  completedCount,
  isComplete,
  canMarkComplete,
  onMarkComplete,
  markCompletePending,
}: Props) {
  const total = Math.max(totalParts, 1);
  const pct = Math.round((Math.min(completedCount, total) / total) * 100);
  const stateBadge = ACCESS_STATE_BADGES[accessState];

  return (
    <header className="space-y-3 border-[var(--color-rule)] border-b px-5 py-5 md:px-8 md:py-7">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-medium font-serif text-[24px] text-[var(--color-ink)] leading-tight md:text-[28px]">
          {activity.title}
        </h1>
        {isComplete ? (
          <Badge tone="good">Complete</Badge>
        ) : stateBadge ? (
          <Badge tone={stateBadge.tone}>{stateBadge.label}</Badge>
        ) : null}
      </div>
      {activity.description ? (
        <p className="max-w-2xl text-[13px] text-[var(--color-ink-2)] leading-relaxed">
          {activity.description}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-[11px] text-[var(--color-ink-2)] tabular-nums">
          {`Part ${Math.min(currentPartIndex + 1, total)} of ${total}`}
        </span>
        <div
          className="h-[2px] min-w-[80px] max-w-[280px] flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]"
          role="progressbar"
          aria-label="Activity completion"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${completedCount} of ${total} parts complete`}
        >
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="font-mono text-[11px] text-[var(--color-ink-2)] tabular-nums">
          {`${completedCount}/${total} done`}
        </span>
        {canMarkComplete ? (
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onMarkComplete}
            disabled={markCompletePending}
          >
            {markCompletePending ? "Marking…" : "Mark activity complete"}
          </Button>
        ) : null}
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
