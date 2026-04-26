import type { MeContext } from "@hearth/domain";
import { AppShell, EmptyState, Skeleton } from "@hearth/ui";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { GroupDetail } from "../../hooks/use-groups.ts";
import { Sidebar } from "../sidebar.tsx";

type LoadedDetail = GroupDetail;

type GroupQueryShape = {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly data: LoadedDetail | undefined;
};

type Props = {
  readonly me: MeContext["data"];
  readonly group: GroupQueryShape;
  readonly children: (detail: LoadedDetail) => ReactNode;
};

/**
 * Shared shell for routes scoped to a single group (group home, people,
 * later library / sessions / activity). Centralizes:
 *   - the AppShell + Sidebar chrome,
 *   - the loading skeleton,
 *   - the "not found / not a member" empty state (always 404-shaped so
 *     existence is not leaked).
 *
 * `children` is a render prop that runs only after the loaded-data
 * branch is reached, so callers can rely on `detail` being defined and
 * the actor having an active membership without re-checking.
 */
export function GroupPageShell({ me, group, children }: Props) {
  const sidebar = <Sidebar me={me} />;
  const instanceTitle = me.instance.name;
  const groupTitle = group.data?.group.name ?? instanceTitle;

  if (group.isLoading) {
    return (
      <AppShell sidebar={sidebar} mobileTitle={instanceTitle}>
        <div className="mx-auto max-w-3xl space-y-3 px-5 py-8 md:px-8">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-32 w-full" />
        </div>
      </AppShell>
    );
  }

  if (group.isError || !group.data) {
    return (
      <AppShell sidebar={sidebar} mobileTitle={instanceTitle}>
        <div className="mx-auto max-w-2xl px-5 py-12 md:px-8">
          <EmptyState
            title="Group not found"
            description="This group may have been removed, or you may not be a member."
          >
            <Link
              to="/"
              search={{}}
              className="text-[13px] text-[var(--color-accent)] underline-offset-2 hover:underline"
            >
              Back to your groups
            </Link>
          </EmptyState>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell sidebar={sidebar} mobileTitle={groupTitle}>
      {children(group.data)}
    </AppShell>
  );
}
