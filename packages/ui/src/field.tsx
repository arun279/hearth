import { type ReactNode, useId } from "react";
import { cn } from "./cn.ts";

export type FieldProps = {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
  /**
   * Renders a visible "required" asterisk next to the label. The
   * asterisk is `aria-hidden` and adds no text to the label's
   * accessible name — keeping selectors like
   * `getByRole("textbox", { name: /^Title$/i })` stable across the
   * required/optional toggle. Required-state announcement to AT
   * comes from the input's HTML `required` attribute (the call site
   * passes the same flag through to the input alongside `id`/
   * `describedBy`). Pair with submit-time validation; the visible
   * mark + the field-level error are the two complementary halves of
   * "tell the user what they need to fill in" (Nielsen #1 + #5).
   */
  readonly required?: boolean;
  readonly children: (props: {
    readonly id: string;
    readonly describedBy: string;
    readonly required: boolean;
  }) => ReactNode;
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
export function Field({ label, hint, error, required = false, children, className }: FieldProps) {
  const base = useId();
  const id = `${base}-control`;
  const describedBy = `${base}-describe`;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block space-y-1.5">
        <span className="block font-medium text-[11px] text-[var(--color-ink-2)] uppercase tracking-wide">
          {label}
          {required ? (
            <span aria-hidden="true" className="ml-1 text-[var(--color-danger)]">
              *
            </span>
          ) : null}
        </span>
        {children({ id, describedBy, required })}
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
        <span id={describedBy} className="block text-[11px] text-[var(--color-ink-2)]">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
