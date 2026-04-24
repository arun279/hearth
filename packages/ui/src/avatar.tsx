import { type HTMLAttributes, useState } from "react";
import { cn } from "./cn.ts";

export type AvatarProps = HTMLAttributes<HTMLDivElement> & {
  readonly name: string;
  readonly src?: string | null;
  readonly size?: number;
};

/** Deterministic hue from name so the same user gets the same tint across renders. */
function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function Avatar({ name, src, size = 28, className, style, ...props }: AvatarProps) {
  // Fall back to the initials tile when `src` is absent OR when the image
  // fails to load (blocked by privacy extensions, Google's auth'd avatar
  // endpoint rate-limiting in incognito, network hiccups, etc.). Without
  // this, a failed avatar leaves a dead rectangle next to the user's name.
  const [imgBroken, setImgBroken] = useState(false);
  const showImage = src !== null && src !== undefined && src !== "" && !imgBroken;
  const hue = hueOf(name);
  return (
    <div
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-medium",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: showImage ? undefined : `hsl(${hue} 55% 85%)`,
        color: showImage ? undefined : `hsl(${hue} 55% 25%)`,
        ...style,
      }}
      {...props}
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setImgBroken(true)}
        />
      ) : (
        <span>{initials(name)}</span>
      )}
    </div>
  );
}
