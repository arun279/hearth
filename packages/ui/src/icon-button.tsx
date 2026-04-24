import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.ts";

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly label: string;
  readonly children: ReactNode;
};

export function IconButton({ label, className, children, type, ...props }: IconButtonProps) {
  return (
    <button
      type={type ?? "button"}
      aria-label={label}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-ink-2)] transition-colors",
        "hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
