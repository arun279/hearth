import type { VisibilityPreference } from "@hearth/domain";
import { Popover, RadioGroup, SaveIndicator, type SaveStatus } from "@hearth/ui";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useSetRecordVisibility } from "../../../hooks/use-activity-record.ts";
import { asUserMessage } from "../../../lib/problem.ts";
import {
  SELECTABLE_VISIBILITY_OVERRIDES,
  VISIBILITY_LABELS,
  visibilityTriggerLabel,
} from "../../../lib/visibility-labels.ts";

type Props = {
  readonly activityId: string;
  /**
   * The RECORD-level override (null = the participant's account default).
   * The control sits beside the reflection because that's where privacy is
   * most salient, but the scope it sets is the whole Activity Record — not
   * this Part.
   */
  readonly value: VisibilityPreference | null;
};

type SelectableVisibilityOverride = (typeof SELECTABLE_VISIBILITY_OVERRIDES)[number];

const isSelectableOverride = (
  value: VisibilityPreference | null,
): value is SelectableVisibilityOverride =>
  value !== null && SELECTABLE_VISIBILITY_OVERRIDES.includes(value as SelectableVisibilityOverride);

export function VisibilitySelector({ activityId, value }: Props) {
  const setVisibility = useSetRecordVisibility(activityId);
  // A stored `default` (legacy explicit pin) selects no radio — it resolves to
  // the same scope as clearing the override, surfaced as "Your default" below.
  const radioValue = isSelectableOverride(value) ? value : null;

  // Mirror the reflection autosave's SaveIndicator model so the change has a
  // durable in-panel "Saving…" / "Saved" / failure signal (Nielsen #1) rather
  // than only a transient toast: the trigger spinner shows in-flight; this pill
  // confirms the outcome while the popover is still open.
  const status: SaveStatus = setVisibility.isError
    ? "error"
    : setVisibility.isPending
      ? "saving"
      : setVisibility.isSuccess
        ? "saved"
        : "idle";

  const pick = (next: VisibilityPreference | null) => {
    setVisibility.mutate(next, {
      onError: (err) => toast.error(asUserMessage(err, "Couldn't update visibility.")),
    });
  };

  return (
    <Popover
      align="end"
      triggerClassName="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] text-[var(--color-ink-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      label={
        <>
          Visibility:{" "}
          <span className="font-medium text-[var(--color-ink)]">
            {visibilityTriggerLabel(value)}
          </span>
          {setVisibility.isPending ? (
            <Loader2
              size={11}
              strokeWidth={1.75}
              className="animate-spin"
              aria-label="Saving visibility"
            />
          ) : (
            <ChevronDown size={11} strokeWidth={1.75} aria-hidden="true" />
          )}
        </>
      }
    >
      <RadioGroup
        legend="Who can see this record"
        legendHidden
        value={radioValue}
        onValueChange={pick}
        disabled={setVisibility.isPending}
        options={SELECTABLE_VISIBILITY_OVERRIDES.map((p) => ({
          value: p,
          label: VISIBILITY_LABELS[p].label,
          description: VISIBILITY_LABELS[p].description,
        }))}
      />
      <p className="mt-2 text-[11px] text-[var(--color-ink-2)]">
        Your track's facilitators always see your full work.
      </p>
      {value !== null ? (
        <button
          type="button"
          onClick={() => pick(null)}
          disabled={setVisibility.isPending}
          className="mt-1.5 rounded-[var(--radius-sm)] text-[11px] text-[var(--color-accent)] underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-60"
        >
          Use my default ({VISIBILITY_LABELS.default.label})
        </button>
      ) : null}
      {status !== "idle" ? (
        <div className="mt-2">
          <SaveIndicator status={status} onRetry={() => pick(setVisibility.variables ?? null)} />
        </div>
      ) : null}
    </Popover>
  );
}
