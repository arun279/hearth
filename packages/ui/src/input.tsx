import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "./cn.ts";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  readonly invalid?: boolean;
};

const base =
  "w-full rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-bg)] " +
  "px-2.5 text-[13px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] " +
  "focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-soft)] " +
  "disabled:opacity-60 disabled:cursor-not-allowed";

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, type, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type ?? "text"}
      aria-invalid={invalid ? "true" : undefined}
      className={cn(
        base,
        "h-8",
        invalid && "border-[var(--color-danger-border)] focus:border-[var(--color-danger)]",
        className,
      )}
      {...props}
    />
  );
});
