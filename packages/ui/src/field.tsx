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
 * Label + control + hint/error — wires `id` / `aria-describedby` so the
 * control inside gets a real label and screen readers announce the hint
 * and inline error. Controls accept a render-prop so react-hook-form
 * `register()` can spread into the right element.
 */
export function Field({ label, hint, error, children, className }: FieldProps) {
  const base = useId();
  const id = `${base}-control`;
  const describedBy = `${base}-describe`;
  return (
    <label htmlFor={id} className={cn("block space-y-1.5", className)}>
      <span className="block text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
        {label}
      </span>
      {children({ id, describedBy })}
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
    </label>
  );
}
