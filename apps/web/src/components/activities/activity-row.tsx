import type { ActivityPartKind, ActivityWindow } from "@hearth/domain";
import { Badge, cn, IconButton, PartIcon } from "@hearth/ui";
import { ChevronRight, Pencil } from "lucide-react";
import type { ActivityListItem } from "../../hooks/use-activities.ts";
import { formatRelative } from "../../lib/format.ts";

type Props = {
  readonly activity: ActivityListItem;
  readonly onOpen: (activityId: string) => void;
  /**
   * Facilitator / Group Admin affordance. When provided, renders a
   * small Edit pencil at the right that opens the composer. Click on
   * the rest of the row routes everyone (authority included) to the
   * Activity Player — the surface where the activity is consumed.
   */
  readonly onEdit?: (activityId: string) => void;
};

/**
 * One row on the Activities tab. Calm, text-focused — title + a small
 * icon strip for the Part-kind sequence + one-line metadata about
 * audience and prereqs.
 *
 * Row click always opens the Activity Player; an authority-only Edit
 * icon button opens the composer separately. The two affordances stay
 * visually distinct so a facilitator's muscle-memory click on the row
 * doesn't surprise them with the composer instead of the reader.
 */
export function ActivityRow({ activity, onOpen, onEdit }: Props) {
  const audienceLabel =
    activity.audienceKind === "everyone_enrolled" ? "Everyone enrolled" : "Selected participants";
  const prereqLabel = prereqPhrase(activity.prereqCount);
  const partsLabel = partsPhrase(activity.partCount);
  const windowLabel = windowPhrase(activity.window);

  return (
    <div
      className={cn(
        "group grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-3 transition-colors",
        "focus-within:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(activity.id)}
        className={cn(
          "min-w-0 space-y-1.5 text-left",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg)]",
        )}
        aria-label={`Open activity: ${activity.title}`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate font-medium text-[0.875rem] text-[var(--color-ink)]">
            {activity.title}
          </h3>
          {activity.audienceKind === "subset" ? <Badge tone="warn">narrowed</Badge> : null}
        </div>
        {activity.description ? (
          <p className="truncate text-[0.75rem] text-[var(--color-ink-2)]">
            {activity.description}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.6875rem] text-[var(--color-ink-3)]">
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
          {windowLabel ? (
            <>
              <span aria-hidden="true">·</span>
              <span
                className={windowLabel.tone === "closed" ? "text-[var(--color-warn)]" : undefined}
              >
                {windowLabel.text}
              </span>
            </>
          ) : null}
        </div>
      </button>
      {onEdit ? (
        <IconButton label={`Edit activity: ${activity.title}`} onClick={() => onEdit(activity.id)}>
          <Pencil size={13} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
      ) : null}
      <ChevronRight
        size={14}
        strokeWidth={1.75}
        aria-hidden="true"
        className="shrink-0 text-[var(--color-ink-3)] transition-transform group-hover:translate-x-0.5"
      />
    </div>
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
        <span className="font-mono text-[0.625rem] text-[var(--color-ink-3)]">
          +{kinds.length - 6}
        </span>
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

/**
 * Picks the most informative window date and frames it as a relative
 * phrase — "due in 3 days", "closes tomorrow", "closed", "opens in 2
 * weeks". Mirrors the prototype's priority: dueAt > closesAt > opensAt.
 * Returns null when the activity has no window at all so a row stays
 * compact for ungated activities. The `closed` tone gives the SPA a
 * single hook for warn-coloured copy without leaking date math into
 * the JSX.
 */
function windowPhrase(
  window: ActivityWindow | null,
): { text: string; tone: "open" | "closed" } | null {
  if (!window) return null;
  const now = new Date();
  const nowMs = now.getTime();
  if (window.closesAt !== null && window.closesAt <= nowMs) {
    return { text: "closed", tone: "closed" };
  }
  if (window.dueAt !== null) {
    return { text: `due ${formatRelative(new Date(window.dueAt), now)}`, tone: "open" };
  }
  if (window.closesAt !== null) {
    return { text: `closes ${formatRelative(new Date(window.closesAt), now)}`, tone: "open" };
  }
  if (window.opensAt !== null) {
    return { text: `opens ${formatRelative(new Date(window.opensAt), now)}`, tone: "open" };
  }
  return null;
}
