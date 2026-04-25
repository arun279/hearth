import type { GroupMembership, StudyGroup } from "@hearth/domain";
import { Badge } from "@hearth/ui";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

type Props = {
  readonly group: StudyGroup;
  readonly myRole: GroupMembership["role"] | null;
};

/**
 * Picker tile for the home screen. The whole card is a link to the group
 * home — the chevron and the `group/...` arrow nudge make the affordance
 * read as "open this group" without needing a separate "Open" button.
 */
export function GroupCard({ group, myRole }: Props) {
  const archived = group.status === "archived";
  return (
    <Link
      to="/g/$groupId"
      params={{ groupId: group.id }}
      className="group block rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] px-4 py-3 transition-colors hover:border-[var(--color-accent-border)] hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-serif font-medium text-[15px] text-[var(--color-ink)]">
            {group.name}
          </div>
          {group.description ? (
            <p className="mt-0.5 line-clamp-2 text-[12px] text-[var(--color-ink-2)]">
              {group.description}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {myRole === "admin" ? <Badge tone="accent">Admin</Badge> : null}
          {archived ? <Badge>archived</Badge> : null}
          <ChevronRight
            size={16}
            strokeWidth={1.5}
            aria-hidden="true"
            className="text-[var(--color-ink-3)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-ink-2)]"
          />
        </div>
      </div>
    </Link>
  );
}
