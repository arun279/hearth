import type { MeContext } from "@hearth/domain";
import { AppShell, EmptyState, Skeleton } from "@hearth/ui";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { TrackDetail } from "../../hooks/use-tracks.ts";
import { Sidebar } from "../sidebar.tsx";

type TrackQueryShape = {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly data: TrackDetail | undefined;
};

type Props = {
  readonly me: MeContext["data"];
  readonly track: TrackQueryShape;
  readonly children: (detail: TrackDetail) => ReactNode;
};

/**
 * Shared shell for routes scoped to a single track. Mirrors
 * `GroupPageShell` so reviewers reading either side recognize the shape.
 * Centralizes the AppShell + Sidebar chrome, the loading skeleton, and
 * the 404-shaped not-found / not-a-member empty state (existence is not
 * leaked through 403/404 distinction — the API uses NOT_FOUND for view
 * denials).
 */
export function TrackPageShell({ me, track, children }: Props) {
  const sidebar = <Sidebar me={me} />;
  const instanceTitle = me.instance.name;
  const trackTitle = track.data?.track.name ?? instanceTitle;

  if (track.isLoading) {
    return (
      <AppShell sidebar={sidebar} mobileTitle={instanceTitle}>
        <div className="mx-auto max-w-3xl space-y-3 px-5 py-8 md:px-8">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-32 w-full" />
        </div>
      </AppShell>
    );
  }

  if (track.isError || !track.data) {
    return (
      <AppShell sidebar={sidebar} mobileTitle={instanceTitle}>
        <div className="mx-auto max-w-2xl px-5 py-12 md:px-8">
          <EmptyState
            title="Track not found"
            description="This Learning Track may have been removed, or you may not be a member of its group."
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
    <AppShell sidebar={sidebar} mobileTitle={trackTitle}>
      {children(track.data)}
    </AppShell>
  );
}
