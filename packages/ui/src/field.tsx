import { type ReactNode, useId } from "react";
import { cn } from "./cn.ts";

export type FieldProps = {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
  readonly children: (ids: { readonly id: string; readonly describedBy: string }) => ReactNode;
  readonly className?: string;
};

/**
 * Label + control + hint/error. The hint/error span is rendered as a
 * sibling of the wrapping `<label>` rather than inside it: a `<label>`'s
 * full text content contributes to the wrapped control's accessible name
 * (per the HTML accessibility spec), which would let an inline error
 * leak into the input's accessible name on every validation failure.
 * The `aria-describedby` link still wires the description to the input.
 */
export function Field({ label, hint, error, children, className }: FieldProps) {
  const base = useId();
  const id = `${base}-control`;
  const describedBy = `${base}-describe`;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block space-y-1.5">
        <span className="block text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
          {label}
        </span>
        {children({ id, describedBy })}
      </label>
      {error ? (
        <span
          id={describedBy}
          role="alert"
          className="block text-[11px] text-[var(--color-danger)]"
        >
          {error}
        </span>
      ) : hint ? (
        <span id={describedBy} className="block text-[11px] text-[var(--color-ink-3)]">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
