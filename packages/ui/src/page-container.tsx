import type { ElementType, HTMLAttributes } from "react";
import { cn } from "./cn.ts";

/**
 * The canonical page-content wrapper: a centered, capped measure with the
 * app's standard gutters. Every in-app route composes this so the content
 * measure is the path of least resistance instead of a hand-copied string.
 *
 *   - `default` → 768px (`max-w-3xl`), the standard body measure.
 *   - `prose`   → 672px (`max-w-2xl`) with deeper top padding, the
 *                 reading / empty-state / not-found measure.
 *
 * `as` lets a route render the wrapper as its `<main>` landmark when it owns
 * the page's main region (e.g. the account stub, which sits outside AppShell).
 */
export type PageContainerProps = HTMLAttributes<HTMLDivElement> & {
  readonly measure?: "default" | "prose";
  readonly as?: ElementType;
};

const MEASURE = {
  default: "mx-auto max-w-3xl px-5 py-8 md:px-8",
  prose: "mx-auto max-w-2xl px-5 py-12 md:px-8",
} as const;

export function PageContainer({
  measure = "default",
  as: Component = "div",
  className,
  ...props
}: PageContainerProps) {
  return <Component className={cn(MEASURE[measure], className)} {...props} />;
}
