import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.ts";

export type BadgeTone = "neutral" | "good" | "warn" | "danger" | "accent";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
};

const tones: Record<BadgeTone, string> = {
  neutral:
    "bg-[var(--color-surface-2)] text-[var(--color-ink-2)] border border-[var(--color-rule)]",
  good: "bg-[var(--color-good-soft)] text-[var(--color-good)] border border-[var(--color-good-border)]",
  warn: "bg-[var(--color-warn-soft)] text-[var(--color-warn)] border border-[var(--color-warn-border)]",
  danger:
    "bg-[var(--color-danger-soft)] text-[var(--color-danger)] border border-[var(--color-danger-border)]",
  accent:
    "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent-border)]",
};

export function Badge({ tone = "neutral", className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 font-medium text-[11px] uppercase tracking-wide",
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
