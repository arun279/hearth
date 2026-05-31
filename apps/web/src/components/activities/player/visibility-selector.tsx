import type { VisibilityPreference } from "@hearth/domain";
import { Popover, RadioGroup } from "@hearth/ui";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { useSetRecordVisibility } from "../../../hooks/use-activity-record.ts";
import { asUserMessage } from "../../../lib/problem.ts";
import { VISIBILITY_LABELS, VISIBILITY_ORDER } from "../../../lib/visibility-labels.ts";

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

export function VisibilitySelector({ activityId, value }: Props) {
  const setVisibility = useSetRecordVisibility(activityId);
  const triggerLabel = value !== null ? VISIBILITY_LABELS[value].label : "Your default";

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
          Visibility: <span className="font-medium text-[var(--color-ink)]">{triggerLabel}</span>
          <ChevronDown size={11} strokeWidth={1.75} aria-hidden="true" />
        </>
      }
    >
      <RadioGroup
        legend="Who can see this record"
        legendHidden
        value={value}
        onValueChange={pick}
        disabled={setVisibility.isPending}
        options={VISIBILITY_ORDER.map((p) => ({
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
          className="mt-1.5 text-[11px] text-[var(--color-accent)] underline hover:no-underline disabled:opacity-60"
        >
          Use my default
        </button>
      ) : null}
    </Popover>
  );
}
