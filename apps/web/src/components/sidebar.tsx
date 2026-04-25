import type { MeContext } from "@hearth/domain";
import { Avatar, Badge, cn, ThemeToggle } from "@hearth/ui";
import { Link, useRouterState } from "@tanstack/react-router";
import { Settings, Users } from "lucide-react";
import { useMyGroups } from "../hooks/use-groups.ts";

type Props = {
  readonly me: MeContext["data"] | null;
};

const SECTION_LABEL_CLASSES =
  "px-1 pt-3 pb-1 font-medium text-[10px] text-[var(--color-ink-3)] uppercase tracking-wide";

const NAV_ITEM_CLASSES = cn(
  "flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-[13px]",
  "transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-none",
  "focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]",
);

const NAV_ITEM_ACTIVE = "bg-[var(--color-surface-2)] font-medium text-[var(--color-ink)]";
const NAV_ITEM_INACTIVE = "text-[var(--color-ink-2)]";

/**
 * Desktop sidebar chrome. Sections (top to bottom):
 *   - Hearth wordmark (links to `/`) + theme toggle
 *   - Current Hearth Instance pill
 *   - "Your groups" — every group the user is a current member of, with the
 *     active group (matching `/g/$groupId`) highlighted via `aria-current`.
 *     Reads from `useMyGroups()` directly so the layout is stable across
 *     routes (Shneiderman #1: consistency) and the user always sees the
 *     groups they belong to (Nielsen #6: recognition over recall, Rams #4:
 *     understandable). React Query dedupes the fetch with the home picker.
 *   - Admin section (operator-only)
 *   - Account card pinned to bottom
 *
 * The Hearth wordmark is the universal "back to home" affordance; without
 * it, deep pages (`/admin/instance`, `/g/$groupId`) have no path back.
 *
 * Tracks / Browse / Library / Sessions / People sections from the design
 * plan land with later milestones (M3, M4, M6, M13) — they are deliberately
 * not pre-built here.
 */
export function Sidebar({ me }: Props) {
  const name = me?.user?.name ?? me?.user?.email ?? null;
  const roleLabel = me?.isOperator ? "Instance Operator" : "Group Member";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isHome = pathname === "/";
  const isOnAdmin = pathname.startsWith("/admin/instance");

  const groupsQuery = useMyGroups(me?.user !== null && me?.user !== undefined);
  const groups = groupsQuery.data ?? [];

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

      {groups.length > 0 ? (
        <nav aria-label="Your groups">
          <div className={SECTION_LABEL_CLASSES}>Your groups</div>
          <ul className="flex flex-col gap-0.5">
            {groups.map((g) => {
              const isActive = pathname === `/g/${g.id}`;
              return (
                <li key={g.id}>
                  <Link
                    to="/g/$groupId"
                    params={{ groupId: g.id }}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(NAV_ITEM_CLASSES, isActive ? NAV_ITEM_ACTIVE : NAV_ITEM_INACTIVE)}
                  >
                    <Users size={14} strokeWidth={1.5} aria-hidden="true" />
                    <span className="truncate">{g.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      {me?.isOperator ? (
        <>
          <div className={SECTION_LABEL_CLASSES}>Admin</div>
          <Link
            to="/admin/instance"
            aria-current={isOnAdmin ? "page" : undefined}
            className={cn(NAV_ITEM_CLASSES, isOnAdmin ? NAV_ITEM_ACTIVE : NAV_ITEM_INACTIVE)}
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
