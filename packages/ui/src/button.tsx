import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.ts";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
  readonly children: ReactNode;
};

const base =
  "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-foreground text-background hover:bg-foreground/90",
  secondary: "bg-muted text-foreground hover:bg-muted/80",
  ghost: "text-foreground hover:bg-muted",
};

export function Button({ variant = "primary", className, children, ...props }: ButtonProps) {
  return (
    <button type="button" className={cn(base, variants[variant], className)} {...props}>
      {children}
    </button>
  );
}
