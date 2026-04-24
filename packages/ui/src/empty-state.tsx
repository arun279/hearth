import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.ts";

export type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
};

export function EmptyState({ title, description, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-rule)] border-dashed px-6 py-10 text-center",
        className,
      )}
      {...props}
    >
      <div className="font-serif text-[var(--color-ink)] text-lg">{title}</div>
      {description ? (
        <div className="max-w-md text-[13px] text-[var(--color-ink-2)]">{description}</div>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
