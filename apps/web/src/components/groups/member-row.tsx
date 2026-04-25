import type { GroupMembership } from "@hearth/domain";
import { Avatar, Badge } from "@hearth/ui";
import { Shield } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  readonly membership: GroupMembership;
  readonly isMe: boolean;
  readonly avatarOrigin: string;
  /** Right-aligned actions slot (e.g. promote/remove buttons in the admin dialog). */
  readonly actions?: ReactNode;
  readonly avatarSize?: number;
};

/**
 * One row in a member list. Shared by the People page (read-only roster)
 * and the GroupMembersDialog (admin actions slot). Centralizing the
 * avatar + display-name + role layout keeps the two surfaces visually
 * locked together and avoids the kind of "almost-identical block"
 * jscpd flags as a clone.
 */
export function MemberRow({ membership, isMe, avatarOrigin, actions, avatarSize = 32 }: Props) {
  const displayName = membership.profile.nickname ?? membership.displayNameSnapshot ?? "Member";
  const avatarSrc =
    membership.profile.avatarUrl !== null && membership.profile.avatarUrl !== ""
      ? `${avatarOrigin}/${membership.profile.avatarUrl}`
      : null;

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <Avatar name={displayName} src={avatarSrc} size={avatarSize} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] text-[var(--color-ink)]">{displayName}</span>
          {isMe ? <Badge tone="accent">you</Badge> : null}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-[var(--color-ink-3)]">
          {membership.role === "admin" ? (
            <span className="inline-flex items-center gap-1">
              <Shield size={11} aria-hidden="true" /> Group Admin
            </span>
          ) : (
            "Member"
          )}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </li>
  );
}
