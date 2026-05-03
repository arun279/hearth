import type { ActivityPartKind } from "@hearth/domain";
import { Badge, cn, PartIcon } from "@hearth/ui";
import { ChevronRight } from "lucide-react";
import type { ActivityListItem } from "../../hooks/use-activities.ts";

type Props = {
  readonly activity: ActivityListItem;
  readonly onSelect: (activityId: string) => void;
};

/**
 * One row on the Activities tab. Calm, text-focused — title + a small
 * icon strip for the Part-kind sequence + one-line metadata about
 * audience and prereqs. The whole row is one button so a keyboard
 * user tabs once and Enter to open.
 */
export function ActivityRow({ activity, onSelect }: Props) {
  const audienceLabel =
    activity.audienceKind === "everyone_enrolled" ? "Everyone enrolled" : "Selected participants";
  const prereqLabel = prereqPhrase(activity.prereqCount);
  const partsLabel = partsPhrase(activity.partCount);

  return (
    <button
      type="button"
      onClick={() => onSelect(activity.id)}
      className={cn(
        "group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-left transition-colors",
        "hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg)]",
      )}
      aria-label={`Open activity: ${activity.title}`}
    >
      <div className="min-w-0 space-y-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate font-medium text-[14px] text-[var(--color-ink)]">
            {activity.title}
          </h3>
          {activity.audienceKind === "subset" ? <Badge tone="warn">narrowed</Badge> : null}
        </div>
        {activity.description ? (
          <p className="truncate text-[12px] text-[var(--color-ink-2)]">{activity.description}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[var(--color-ink-3)]">
          <PartKindStrip kinds={activity.partKindSequence as readonly ActivityPartKind[]} />
          <span aria-hidden="true">·</span>
          <span>{partsLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{audienceLabel}</span>
          {prereqLabel ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{prereqLabel}</span>
            </>
          ) : null}
        </div>
      </div>
      <ChevronRight
        size={14}
        strokeWidth={1.75}
        aria-hidden="true"
        className="shrink-0 text-[var(--color-ink-3)] transition-transform group-hover:translate-x-0.5"
      />
    </button>
  );
}

function PartKindStrip({ kinds }: { readonly kinds: readonly ActivityPartKind[] }) {
  // The composer refuses to save with zero Parts, so a saved activity
  // always carries at least one entry. The strip therefore renders
  // unconditionally — no zero-Parts branch.
  return (
    <div className="flex items-center gap-1">
      {kinds.slice(0, 6).map((kind, i) => (
        <PartIcon
          // Multiple parts may share a kind; index disambiguates so the
          // strip's keys stay stable for React reconciliation across edits.
          key={`${kind}-${i}`}
          kind={kind}
          size={11}
          className="text-[var(--color-ink-3)]"
        />
      ))}
      {kinds.length > 6 ? (
        <span className="font-mono text-[10px] text-[var(--color-ink-3)]">+{kinds.length - 6}</span>
      ) : null}
    </div>
  );
}

function partsPhrase(n: number): string {
  if (n === 1) return "1 part";
  return `${n} parts`;
}

function prereqPhrase(n: number): string | null {
  if (n === 0) return null;
  if (n === 1) return "1 prereq";
  return `${n} prereqs`;
}
