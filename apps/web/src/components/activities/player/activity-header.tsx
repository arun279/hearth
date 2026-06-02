import type { ActivityPlayerProjection, LearningActivity } from "@hearth/domain";
import { Badge } from "@hearth/ui";

type Props = {
  readonly activity: LearningActivity;
  readonly accessState: ActivityPlayerProjection["accessState"];
  readonly currentPartIndex: number;
  readonly totalParts: number;
};

/**
 * Title strip above the player body. Mirrors the prototype's calm-text
 * hierarchy:
 *
 *   - Big serif title (the activity name).
 *   - Optional description in muted body text.
 *   - Status row: an access-state badge (only when non-`open`), the
 *     monospace "Part X of N" counter, and an empty completion track.
 *
 * The completion track holds at 0% until per-Part completion state is
 * persisted; reserving the visual now keeps the layout final so the
 * data wire-up later is the only thing that needs to change. Showing
 * cursor position as if it were completion would be dishonest — the
 * track is intentionally empty until there's real progress to report.
 */
export function ActivityHeader({ activity, accessState, currentPartIndex, totalParts }: Props) {
  const COMPLETION_PROGRESS = 0;
  const stateBadge = ACCESS_STATE_BADGES[accessState];

  return (
    <header className="space-y-3 border-[var(--color-rule)] border-b px-5 py-5 md:px-8 md:py-7">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-medium font-serif text-[24px] text-[var(--color-ink)] leading-tight md:text-[28px]">
          {activity.title}
        </h1>
        {stateBadge ? <Badge tone={stateBadge.tone}>{stateBadge.label}</Badge> : null}
      </div>
      {activity.description ? (
        <p className="max-w-2xl text-[13px] text-[var(--color-ink-2)] leading-relaxed">
          {activity.description}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-[11px] text-[var(--color-ink-2)] tabular-nums">
          Part {Math.min(currentPartIndex + 1, Math.max(totalParts, 1))} of{" "}
          {Math.max(totalParts, 1)}
        </span>
        <div
          className="h-[2px] min-w-[80px] max-w-[280px] flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]"
          role="progressbar"
          aria-label="Activity completion"
          aria-valuenow={COMPLETION_PROGRESS}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-200"
            style={{ width: `${COMPLETION_PROGRESS}%` }}
          />
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
