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
    <li className="flex items-center gap-3 px-3 py-2.5">
      <Avatar name={displayName} src={avatarSrc} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] text-[var(--color-ink)]">{displayName}</span>
          {isMe ? <Badge tone="accent">you</Badge> : null}
          {/* Role pill stays neutral so it doesn't fight the accent-tone
              `you` badge for visual prominence — the personal indicator
              should win when both are present. Mirrors the M3
              MemberRow convention. */}
          {enrollment.role === "facilitator" ? <Badge>facilitator</Badge> : <Badge>enrolled</Badge>}
          {enrollment.leftAt !== null ? <Badge tone="neutral">left</Badge> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </li>
  );
}
