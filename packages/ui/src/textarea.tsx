import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn.ts";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  readonly invalid?: boolean;
};

const base =
  "w-full rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-bg)] " +
  "px-2.5 py-2 text-[13px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] " +
  "focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-soft)] " +
  "disabled:opacity-60 disabled:cursor-not-allowed";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, rows, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows ?? 4}
      aria-invalid={invalid ? "true" : undefined}
      className={cn(
        base,
        invalid && "border-[var(--color-danger-border)] focus:border-[var(--color-danger)]",
        className,
      )}
      {...props}
    />
  );
});
