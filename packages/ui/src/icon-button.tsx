import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.ts";

export type IconButtonTone = "neutral" | "danger";

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly label: string;
  /**
   * `danger` flags a destructive action (remove / delete) so the hover +
   * focus affordance reads red — the entry point matches the consequence
   * it leads to, instead of looking identical to a benign icon button.
   * The resting state stays neutral so a row of remove buttons isn't a
   * wall of red. Default `neutral`.
   */
  readonly tone?: IconButtonTone;
  readonly children: ReactNode;
};

const tones: Record<IconButtonTone, string> = {
  neutral:
    "text-[var(--color-ink-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] focus-visible:ring-[var(--color-accent)]",
  danger:
    "text-[var(--color-ink-2)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)] focus-visible:ring-[var(--color-danger)]",
};

export function IconButton({
  label,
  tone = "neutral",
  className,
  children,
  type,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type ?? "button"}
      aria-label={label}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-40",
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
