import { Link } from "@tanstack/react-router";

type Props = {
  readonly groupId: string;
  readonly groupName: string;
  readonly currentLabel: string;
};

/**
 * Breadcrumb header shared by the per-group subpages (People, Library —
 * Sessions / Activity will add themselves here as those land). Keeps the
 * `<Link to="/g/$groupId">` pattern in one place so a route refactor
 * touches one component instead of every subpage.
 */
export function GroupSubpageBreadcrumb({ groupId, groupName, currentLabel }: Props) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-2 text-[12px] text-[var(--color-ink-3)]"
    >
      <Link to="/" search={{}} className="hover:text-[var(--color-ink-2)]">
        Your groups
      </Link>
      <span aria-hidden="true">/</span>
      <Link
        to="/g/$groupId"
        params={{ groupId }}
        search={{}}
        className="hover:text-[var(--color-ink-2)]"
      >
        {groupName}
      </Link>
      <span aria-hidden="true">/</span>
      <span className="text-[var(--color-ink-2)]">{currentLabel}</span>
    </nav>
  );
}
