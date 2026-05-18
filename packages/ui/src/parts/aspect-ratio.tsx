import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "../cn.ts";

export type AspectRatioProps = HTMLAttributes<HTMLDivElement> & {
  /**
   * Numeric ratio of width / height. 16/9 video defaults to 1.7778; a
   * square is 1; a tall poster might be 0.75. Use the literal fraction
   * (e.g., `16 / 9`) so the call site reads at a glance.
   */
  readonly ratio: number;
  readonly children: ReactNode;
};

/**
 * Constrain a slot to a fixed aspect ratio. The child fills the slot via
 * absolute positioning so any iframe / `<video>` inside scales without
 * intrinsic-size knowledge. Built on the modern CSS `aspect-ratio`
 * property — no padding-bottom hack, no JS measuring.
 *
 * Designed for embed iframes (YouTube 16:9, Spotify recommended 1:1) and
 * for video player frames where the underlying media's intrinsic
 * dimensions vary. The wrapper supplies a stable frame; the renderer
 * inside fills it.
 */
export function AspectRatio({ ratio, className, children, style, ...props }: AspectRatioProps) {
  const composedStyle: CSSProperties = { aspectRatio: String(ratio), ...style };
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-surface-2)]",
        className,
      )}
      style={composedStyle}
      {...props}
    >
      <div className="absolute inset-0 [&>*]:h-full [&>*]:w-full">{children}</div>
    </div>
  );
}
