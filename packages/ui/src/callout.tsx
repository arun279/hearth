import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.ts";

export type CalloutTone = "neutral" | "accent" | "good" | "warn" | "danger";

export type CalloutProps = HTMLAttributes<HTMLDivElement> & {
  readonly tone?: CalloutTone;
  readonly title?: ReactNode;
  readonly children: ReactNode;
};

const tones: Record<CalloutTone, string> = {
  neutral: "bg-[var(--color-surface)] border-[var(--color-rule)] text-[var(--color-ink)]",
  accent:
    "bg-[var(--color-accent-soft)] border-[var(--color-accent-border)] text-[var(--color-ink)]",
  good: "bg-[var(--color-good-soft)] border-[var(--color-good-border)] text-[var(--color-ink)]",
  warn: "bg-[var(--color-warn-soft)] border-[var(--color-warn-border)] text-[var(--color-ink)]",
  danger:
    "bg-[var(--color-danger-soft)] border-[var(--color-danger-border)] text-[var(--color-ink)]",
};

// State-change tones expose a live region so the Callout is announced
// when it appears mid-flow. Static tones stay silent to avoid AT noise.
function roleFor(tone: CalloutTone): { role?: string; "aria-live"?: "polite" | "assertive" } {
  if (tone === "warn") return { role: "status", "aria-live": "polite" };
  if (tone === "danger") return { role: "alert", "aria-live": "assertive" };
  return {};
}

export function Callout({ tone = "neutral", title, className, children, ...props }: CalloutProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border px-3 py-2.5 text-[13px]",
        tones[tone],
        className,
      )}
      {...roleFor(tone)}
      {...props}
    >
      {title ? <div className="mb-1 font-medium">{title}</div> : null}
      <div className="text-[var(--color-ink-2)]">{children}</div>
    </div>
  );
}
