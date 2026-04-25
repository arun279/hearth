import type { HTMLAttributes } from "react";
import { cn } from "./cn.ts";

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/**
 * Placeholder block that fades subtly; mirrors the prototype's "calm" motion
 * language — no chevron-shimmer, no pulse-scale, just a low-contrast block.
 */
export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-[var(--radius-md)] bg-[var(--color-surface-2)]",
        className,
      )}
      {...props}
    />
  );
}
