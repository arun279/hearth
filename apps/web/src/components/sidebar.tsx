import type { MeContext, StudyGroup } from "@hearth/domain";
import { Avatar, Badge, cn, ThemeToggle } from "@hearth/ui";
import { Link, useRouterState } from "@tanstack/react-router";
import { Settings } from "lucide-react";

type Props = {
  readonly me: MeContext["data"] | null;
  /**
   * Optional group context. When the user is on `/g/$groupId`, the route
   * passes the loaded group so the sidebar can show a "Study Group"
   * section above Admin — matches the design plan's desktop sidebar
   * spec (current group → tracks → browse → admin). Tracks/browse
   * sections land with later milestones.
   */
  readonly activeGroup?: Pick<StudyGroup, "id" | "name"> | null;
};

const SECTION_LABEL_CLASSES =
  "px-1 pt-3 pb-1 font-medium text-[10px] text-[var(--color-ink-3)] uppercase tracking-wide";

const NAV_ITEM_CLASSES = cn(
  "flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-[13px]",
  "transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-none",
  "focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]",
);

/**
 * Desktop sidebar chrome. Sections (top to bottom):
 *   - Hearth wordmark (links to `/`) + theme toggle
 *   - Current Hearth Instance pill
 *   - Study Group section (when a group is active)
 *   - Admin section (operator-only)
 *   - Account card pinned to bottom
 *
 * The Hearth wordmark is the universal "back to home" affordance —
 * standard web convention; Nielsen heuristic #4 (consistency &
 * standards). Without it, deep pages like `/admin/instance` and
 * `/g/$groupId` have no escape path back to the picker.
 */
export function Sidebar({ me, activeGroup }: Props) {
  const name = me?.user?.name ?? me?.user?.email ?? null;
  const roleLabel = me?.isOperator ? "Instance Operator" : "Group Member";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isHome = pathname === "/";
  const isOnActiveGroup =
    activeGroup !== undefined && activeGroup !== null && pathname === `/g/${activeGroup.id}`;
  const isOnAdmin = pathname.startsWith("/admin/instance");

  return (
    <div className="flex h-full flex-col gap-1">
      <div className="flex items-center gap-2 px-2 pt-1 pb-3">
        <Link
          to="/"
          search={{}}
          aria-label="Hearth — back to your groups"
          aria-current={isHome ? "page" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-[var(--radius-sm)] focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]",
          )}
        >
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-ink)] font-bold text-[11px] text-[var(--color-bg)]">
            H
          </div>
          <div className="font-semibold font-serif text-[15px] text-[var(--color-ink)]">Hearth</div>
        </Link>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>

      {me ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-bg)] px-2 py-2">
          <div className="flex items-center gap-1.5">
            <div className="font-medium text-[10px] text-[var(--color-ink-3)] uppercase tracking-wide">
              Hearth Instance
            </div>
            <Badge tone="warn" className="ml-auto">
              private
            </Badge>
          </div>
          <div className="mt-0.5 truncate text-[12px] text-[var(--color-ink)]">
            {me.instance.name}
          </div>
        </div>
      ) : null}

      {activeGroup ? (
        <>
          <div className={SECTION_LABEL_CLASSES}>Study group</div>
          <Link
            to="/g/$groupId"
            params={{ groupId: activeGroup.id }}
            aria-current={isOnActiveGroup ? "page" : undefined}
            className={cn(
              NAV_ITEM_CLASSES,
              isOnActiveGroup
                ? "bg-[var(--color-surface-2)] font-medium text-[var(--color-ink)]"
                : "text-[var(--color-ink-2)]",
            )}
          >
            <span className="truncate">{activeGroup.name}</span>
          </Link>
        </>
      ) : null}

      {me?.isOperator ? (
        <>
          <div className={SECTION_LABEL_CLASSES}>Admin</div>
          <Link
            to="/admin/instance"
            aria-current={isOnAdmin ? "page" : undefined}
            className={cn(
              NAV_ITEM_CLASSES,
              isOnAdmin
                ? "bg-[var(--color-surface-2)] font-medium text-[var(--color-ink)]"
                : "text-[var(--color-ink-2)]",
            )}
          >
            <Settings size={14} strokeWidth={1.5} aria-hidden="true" />
            Instance settings
          </Link>
        </>
      ) : null}

      <div className="flex-1" />

      {name ? (
        <div className="flex items-center gap-2 border-[var(--color-rule)] border-t px-2 pt-2.5 pb-1">
          <Avatar name={name} src={me?.user?.image ?? null} size={28} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-[12px] text-[var(--color-ink)]">
              {me?.user?.name ?? "Member"}
            </div>
            <div className="truncate text-[11px] text-[var(--color-ink-3)]">{roleLabel}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
