import type { MeContext } from "@hearth/domain";
import { AppShell, Avatar, Badge, Button, Callout, EmptyState, Skeleton } from "@hearth/ui";
import type { QueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { GroupSettingsDialog } from "../components/groups/group-settings-dialog.tsx";
import { Sidebar } from "../components/sidebar.tsx";
import { useGroup } from "../hooks/use-groups.ts";
import { useMeContext } from "../hooks/use-me-context.ts";

const searchSchema = z.object({
  settings: z.enum(["open"]).optional(),
});

export const Route = createFileRoute("/g/$groupId")({
  validateSearch: searchSchema,
  // Resolve the cached `me/context` (or fetch it on first navigation) and
  // bounce anonymous users to `/` so the sign-in screen lives in one place.
  // The SPA already caches `me/context` for 60s — `fetchQuery` is a no-op
  // when the cache is fresh.
  beforeLoad: async ({ context }) => {
    const me = await fetchMe(context.queryClient);
    if (!me?.user) {
      throw redirect({ to: "/", search: {} });
    }
  },
  component: GroupHome,
});

async function fetchMe(queryClient: QueryClient): Promise<MeContext["data"] | null> {
  const result = await queryClient
    .fetchQuery<MeContext>({
      queryKey: ["me", "context"],
      queryFn: async () => {
        const { api } = await import("../lib/api-client.ts");
        const res = await api.me.context.$get();
        if (!res.ok) throw new Error(`me/context ${res.status}`);
        return (await res.json()) as MeContext;
      },
      staleTime: 60_000,
    })
    .catch(() => null);
  return result?.data ?? null;
}

function GroupHome() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const me = useMeContext();
  const signedIn = me.data?.data.user !== null && me.data?.data.user !== undefined;
  const group = useGroup(params.groupId, signedIn);

  const [settingsOpenLocal, setSettingsOpenLocal] = useState(false);
  // Allow `?settings=open` to deep-link the dialog open. Closing the dialog
  // strips the param so the URL doesn't keep the modal "stuck open" on
  // navigation back.
  const settingsOpen = settingsOpenLocal || search.settings === "open";

  if (me.isLoading || !me.data?.data.user) {
    return <FullPageMessage>Loading…</FullPageMessage>;
  }

  if (group.isLoading) {
    return (
      <AppShell sidebar={<Sidebar me={me.data.data} />} mobileTitle={me.data.data.instance.name}>
        <div className="mx-auto max-w-3xl space-y-4 px-5 py-8 md:px-8">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-4 w-full" />
        </div>
      </AppShell>
    );
  }

  if (group.isError || !group.data) {
    // The API returns 404 (problem+json `not_group_member`) for both
    // "doesn't exist" and "not a member"; the SPA shows the same friendly
    // copy either way so existence is not leaked client-side either.
    return (
      <AppShell sidebar={<Sidebar me={me.data.data} />} mobileTitle={me.data.data.instance.name}>
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

  const { group: g, caps, counts } = group.data;
  const archived = g.status === "archived";
  const myRole = group.data.myMembership?.role ?? null;

  return (
    <AppShell sidebar={<Sidebar me={me.data.data} />} mobileTitle={g.name}>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-8">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-2 text-[12px] text-[var(--color-ink-3)]"
        >
          <Link to="/" search={{}} className="hover:text-[var(--color-ink-2)]">
            Your groups
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-[var(--color-ink-2)] truncate">{g.name}</span>
        </nav>

        <header className="mt-3 space-y-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="font-serif text-[28px] leading-tight text-[var(--color-ink)]">
                {g.name}
              </h1>
              {g.description ? (
                <p className="mt-1 text-[13px] text-[var(--color-ink-2)]">{g.description}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {archived ? <Badge>archived</Badge> : <Badge tone="good">active</Badge>}
              <Badge tone="warn">{g.admissionPolicy.replace("_", " ")}</Badge>
              {myRole === "admin" ? <Badge tone="accent">Group Admin</Badge> : null}
            </div>
          </div>

          {caps.canArchive || caps.canUnarchive || caps.canUpdateMetadata ? (
            <div>
              <Button variant="secondary" size="sm" onClick={() => setSettingsOpenLocal(true)}>
                <Settings size={12} strokeWidth={1.75} aria-hidden="true" />
                Group settings
              </Button>
            </div>
          ) : null}
        </header>

        {archived ? (
          <Callout tone="warn" title="This group is archived" className="mt-5">
            New work is paused; history remains readable. A Group Admin can unarchive from settings.
          </Callout>
        ) : null}

        <section className="mt-6 space-y-2" aria-labelledby="tracks-heading">
          <h2
            id="tracks-heading"
            className="font-medium text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]"
          >
            Learning Tracks · {counts.trackCount}
          </h2>
          <EmptyState
            title="No tracks yet"
            description={
              myRole === "admin"
                ? "Create the first Learning Track to organise activities for this group."
                : "Your Group Admin hasn't created a Learning Track yet."
            }
          />
        </section>

        <section className="mt-6 space-y-2" aria-labelledby="people-heading">
          <h2
            id="people-heading"
            className="font-medium text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]"
          >
            People · {counts.memberCount}
          </h2>
          {group.data.myMembership && me.data.data.user ? (
            <ul
              aria-label="Group members"
              className="divide-y divide-[var(--color-rule)] rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)]"
            >
              <li className="flex items-center gap-3 px-3 py-2.5">
                <Avatar
                  name={me.data.data.user.name ?? me.data.data.user.email}
                  src={me.data.data.user.image ?? null}
                  size={32}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-[13px] text-[var(--color-ink)]">
                      {me.data.data.user.name ?? me.data.data.user.email}
                    </span>
                    <Badge tone="accent">you</Badge>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-[var(--color-ink-3)]">
                    {group.data.myMembership.role === "admin" ? "Group Admin" : "Member"}
                  </div>
                </div>
              </li>
            </ul>
          ) : (
            <EmptyState
              title="Members and invitations"
              description="The roster appears here once group membership lands."
            />
          )}
        </section>

        <section className="mt-6 space-y-2" aria-labelledby="library-heading">
          <h2
            id="library-heading"
            className="font-medium text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]"
          >
            Library · {counts.libraryItemCount}
          </h2>
          <EmptyState
            title="The shared Library is empty"
            description="Stewards upload PDFs, audio, and other materials here once the Library aggregate ships."
          />
        </section>
      </div>

      <GroupSettingsDialog
        open={settingsOpen}
        group={g}
        caps={caps}
        onClose={() => {
          setSettingsOpenLocal(false);
          if (search.settings) {
            void navigate({ search: {} });
          }
        }}
      />
    </AppShell>
  );
}

function FullPageMessage({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center text-[var(--color-ink-3)]">
      {children}
    </div>
  );
}
