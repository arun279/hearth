import { Avatar } from "./avatar.tsx";
import { cn } from "./cn.ts";

export type AvatarStackEntry = {
  readonly key: string;
  readonly name: string;
  readonly src?: string | null;
};

export type AvatarStackProps = {
  readonly entries: readonly AvatarStackEntry[];
  /** Pixel size of each avatar. Defaults to 24, matching the prototype's hero band. */
  readonly size?: number;
  /** Cap visible avatars; the rest collapse into a +N tile. Defaults to 4. */
  readonly max?: number;
  /** Accessible group label (e.g., "Facilitators: Maya, Rafael"). Required. */
  readonly ariaLabel: string;
  readonly className?: string;
};

/**
 * Overlapping circular avatars with a ring matching the page background so
 * adjacent tiles read as separate. Mirrors the design prototype's hero
 * facilitator stack: each subsequent avatar shifts left by ~25% of its
 * width and gets a 2px ring; an overflow tile collapses any extras into
 * "+N" so the row stays compact at small widths.
 *
 * Visual layout is decorative — the `ariaLabel` summarises the entries for
 * AT users; individual avatar tiles are aria-hidden.
 */
export function AvatarStack({
  entries,
  size = 24,
  max = 4,
  ariaLabel,
  className,
}: AvatarStackProps) {
  if (entries.length === 0) return null;
  const visible = entries.slice(0, max);
  const overflow = entries.length - visible.length;
  const offset = Math.round(size * 0.3);

  return (
    // role="group" (not <fieldset>) because this is a thematic grouping of
    // decorative avatars, not a form-control group. <fieldset>+<legend> would
    // make AT consume the group as a form region; we want a single named
    // landmark that summarises the avatars for screen readers.
    // biome-ignore lint/a11y/useSemanticElements: see comment above
    <div role="group" aria-label={ariaLabel} className={cn("inline-flex items-center", className)}>
      {visible.map((entry, idx) => (
        <div
          key={entry.key}
          aria-hidden="true"
          className="ring-2 ring-[var(--color-bg)]"
          style={{
            marginLeft: idx === 0 ? 0 : -offset,
            borderRadius: 9999,
          }}
        >
          <Avatar name={entry.name} src={entry.src ?? null} size={size} />
        </div>
      ))}
      {overflow > 0 ? (
        <div
          aria-hidden="true"
          className="inline-flex select-none items-center justify-center rounded-full bg-[var(--color-surface-2)] font-medium text-[var(--color-ink-2)] ring-2 ring-[var(--color-bg)]"
          style={{
            width: size,
            height: size,
            fontSize: Math.round(size * 0.4),
            marginLeft: -offset,
          }}
        >
          +{overflow}
        </div>
      ) : null}
    </div>
  );
}
