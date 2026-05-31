import { type ReactNode, useId } from "react";
import { cn } from "./cn.ts";

export type RadioOption<T extends string> = {
  readonly value: T;
  readonly label: ReactNode;
  readonly description?: ReactNode;
};

export type RadioGroupProps<T extends string> = {
  readonly legend: ReactNode;
  readonly value: T | null;
  readonly onValueChange: (value: T) => void;
  readonly options: ReadonlyArray<RadioOption<T>>;
  /** Shared `name` for the native radios; defaults to a generated id. */
  readonly name?: string;
  readonly disabled?: boolean;
  /** Hide the legend visually while keeping it for assistive tech. */
  readonly legendHidden?: boolean;
  readonly className?: string;
};

/**
 * Accessible single-select built on native `<input type="radio">` inside a
 * `<fieldset>` — arrow-key navigation, screen-reader grouping, and the
 * required/selected state all come for free from the platform. Each option
 * renders as a selectable row (the prototype's option-card look); the
 * selected row carries an accent border + fill so the state is conveyed by
 * shape, not colour alone (WCAG 1.4.1).
 */
export function RadioGroup<T extends string>({
  legend,
  value,
  onValueChange,
  options,
  name,
  disabled = false,
  legendHidden = false,
  className,
}: RadioGroupProps<T>) {
  const generated = useId();
  const groupName = name ?? generated;
  return (
    <fieldset className={cn("flex flex-col gap-1.5", className)} disabled={disabled}>
      <legend
        className={cn(
          legendHidden
            ? "sr-only"
            : "mb-1 block font-medium text-[11px] text-[var(--color-ink-2)] uppercase tracking-wide",
        )}
      >
        {legend}
      </legend>
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <label
            key={opt.value}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-md)] border px-3 py-2 text-[13px]",
              selected
                ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                : "border-[var(--color-rule)] bg-[var(--color-bg)] hover:bg-[var(--color-surface-2)]",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="radio"
              name={groupName}
              value={opt.value}
              checked={selected}
              onChange={() => onValueChange(opt.value)}
              disabled={disabled}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)]"
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[var(--color-ink)]">{opt.label}</span>
              {opt.description ? (
                <span className="text-[11px] text-[var(--color-ink-2)]">{opt.description}</span>
              ) : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
