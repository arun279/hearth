import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.ts";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly children: ReactNode;
};

// `whitespace-nowrap`: a button's fixed height (`h-7`/`h-8`) cannot fit a
// wrapped label. Make the layout absorb pressure, not the label.
const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] font-medium transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-[var(--color-bg)] disabled:opacity-50 disabled:pointer-events-none";

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[0.75rem]",
  md: "h-8 px-3 text-[0.8125rem]",
};

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--color-accent)] text-[var(--color-accent-on)] hover:bg-[var(--color-accent-hover)]",
  secondary:
    "bg-[var(--color-surface)] text-[var(--color-ink)] border border-[var(--color-rule)] hover:bg-[var(--color-surface-2)]",
  ghost:
    "text-[var(--color-ink-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]",
  danger: "bg-[var(--color-danger)] text-white hover:bg-[var(--color-danger)]/90",
};

/**
 * The Button's class string, factored out so a non-`<button>` element that
 * must look like a button (e.g. a router `<Link>` used as a primary CTA) can
 * reuse the exact tokens instead of hand-copying them and drifting. Button
 * itself composes through here so the two never diverge.
 */
export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(base, sizes[size], variants[variant], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  type,
  ...props
}: ButtonProps) {
  return (
    <button type={type ?? "button"} className={buttonClasses(variant, size, className)} {...props}>
      {children}
    </button>
  );
}
