import type { MeContext } from "@hearth/domain";
import { Avatar, Badge, ThemeToggle } from "@hearth/ui";

type Props = {
  readonly me: MeContext["data"] | null;
};

/**
 * Desktop sidebar chrome. In M0 the group / track / admin sections are empty
 * because those aggregates have not landed yet — the structural header + user
 * pill still render so the layout matches what will ship in M1+.
 */
export function Sidebar({ me }: Props) {
  const name = me?.user?.name ?? me?.user?.email ?? null;
  return (
    <div className="flex h-full flex-col gap-1">
      <div className="flex items-center gap-2 px-2 pt-1 pb-3">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-ink)] font-bold text-[11px] text-[var(--color-bg)]">
          H
        </div>
        <div className="font-semibold font-serif text-[15px] text-[var(--color-ink)]">Hearth</div>
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

      <div className="flex-1" />

      {name ? (
        <div className="flex items-center gap-2 border-[var(--color-rule)] border-t px-2 pt-2.5 pb-1">
          <Avatar name={name} src={me?.user?.image ?? null} size={28} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-[12px] text-[var(--color-ink)]">
              {me?.user?.name ?? "Member"}
            </div>
            <div className="truncate text-[11px] text-[var(--color-ink-3)]">
              {me?.isOperator ? "Instance Operator" : "Group Member"}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
