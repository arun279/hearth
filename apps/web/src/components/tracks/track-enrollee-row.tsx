import type { TrackEnrollment } from "@hearth/domain";
import { Avatar, Badge } from "@hearth/ui";
import type { ReactNode } from "react";

type Props = {
  readonly enrollment: TrackEnrollment;
  /**
   * Server-resolved label (nickname → user.name → user.email →
   * displayNameSnapshot). The use case rolls these up so the SPA
   * doesn't N+1 the `users` table per row.
   */
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly avatarOrigin: string;
  readonly isMe: boolean;
  /** Right-aligned actions slot (e.g. promote / demote / remove buttons). */
  readonly actions?: ReactNode;
};

/**
 * One row in the track People list. Mirrors `MemberRow` so the two
 * surfaces feel identical — only the role pill copy and actions differ.
 */
export function TrackEnrolleeRow({
  enrollment,
  displayName,
  avatarUrl,
  avatarOrigin,
  isMe,
  actions,
}: Props) {
  const avatarSrc =
    avatarUrl !== null && avatarUrl.length > 0 ? `${avatarOrigin}/${avatarUrl}` : null;

  return (
    // Stack identity (avatar + name + badges) and actions on separate
    // visual rows below the `sm` breakpoint. With three-button rosters
    // (Promote / Demote / Remove) the horizontal layout would otherwise
    // crush the display-name container to zero width at 375px and clip
    // the role pill ("FACI…") — sighted touch users couldn't tell who
    // they were about to mutate. At ≥sm the row collapses back to a
    // single horizontal line with actions floated right.
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 items-center gap-3 sm:flex-1">
        <Avatar name={displayName} src={avatarSrc} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[13px] text-[var(--color-ink)]">{displayName}</span>
            {isMe ? <Badge tone="accent">you</Badge> : null}
            {/* Role pill stays neutral so it doesn't fight the accent-tone
                `you` badge for visual prominence — the personal indicator
                should win when both are present. Mirrors the M3
                MemberRow convention. */}
            {enrollment.role === "facilitator" ? (
              <Badge>facilitator</Badge>
            ) : (
              <Badge>enrolled</Badge>
            )}
            {enrollment.leftAt !== null ? <Badge tone="neutral">left</Badge> : null}
          </div>
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:ml-auto">{actions}</div>
      ) : null}
    </li>
  );
}
