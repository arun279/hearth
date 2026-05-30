import { Button } from "@hearth/ui";
import { Check } from "lucide-react";

/**
 * Honor-system "this Part is done" control. Completion is always a deliberate
 * participant act and is never gated by soft nudges (a reflection's `minWords`
 * meter never disables it). It is disabled only when the activity's window is
 * closed or a hard prerequisite Part is still incomplete — `hint` names which,
 * so a dimmed button is never a dead end the participant can't explain.
 */
export function PartCompleteButton({
  completed,
  disabled,
  pending,
  hint,
  onToggle,
}: {
  readonly completed: boolean;
  readonly disabled: boolean;
  readonly pending: boolean;
  readonly hint?: string;
  readonly onToggle: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant={completed ? "secondary" : "primary"}
        size="sm"
        onClick={onToggle}
        disabled={disabled || pending}
        aria-pressed={completed}
        title={disabled ? hint : undefined}
      >
        <Check
          size={14}
          strokeWidth={2}
          aria-hidden="true"
          className={completed ? "text-[var(--color-good)]" : undefined}
        />
        {completed ? "Completed" : "Mark complete"}
      </Button>
      {disabled && hint ? (
        <span className="text-[11px] text-[var(--color-ink-3)]">{hint}</span>
      ) : null}
    </div>
  );
}
