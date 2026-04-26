import type { GroupMembership } from "@hearth/domain";
import { Button, Callout, EmptyState, Skeleton } from "@hearth/ui";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { LogOut, Settings } from "lucide-react";
import { useState } from "react";
import { AvatarUploader } from "../components/groups/avatar-uploader.tsx";
import { GroupMembersDialog } from "../components/groups/group-members-dialog.tsx";
import { GroupPageShell } from "../components/groups/group-page-shell.tsx";
import { InvitationsPanel } from "../components/groups/invitations-panel.tsx";
import { InviteDialog } from "../components/groups/invite-dialog.tsx";
import { LeaveGroupDialog } from "../components/groups/leave-group-dialog.tsx";
import { MemberRow } from "../components/groups/member-row.tsx";
import { useGroupMembers } from "../hooks/use-group-members.ts";
import { useGroup } from "../hooks/use-groups.ts";
import { useMeContext } from "../hooks/use-me-context.ts";
import { loadMeContextOrNull } from "../lib/me-context.ts";

// Build-time injection so the SPA renders public R2 asset URLs without
// round-tripping the Worker. Vite reads `VITE_R2_PUBLIC_ORIGIN` from
// `.env` / `.env.production`.
const PUBLIC_AVATAR_ORIGIN = (
  (import.meta as unknown as { env: Record<string, string | undefined> }).env[
    "VITE_R2_PUBLIC_ORIGIN"
  ] ?? ""
).replace(/\/$/, "");

export const Route = createFileRoute("/g/$groupId_/people")({
  beforeLoad: async ({ context }) => {
    const me = await loadMeContextOrNull(context.queryClient);
    if (!me?.user) {
      throw redirect({ to: "/", search: {} });
    }
  },
  component: PeoplePage,
});

function PeoplePage() {
  const params = Route.useParams();
  const me = useMeContext();
  const signedIn = me.data?.data.user !== null && me.data?.data.user !== undefined;
  const group = useGroup(params.groupId, signedIn);
  const members = useGroupMembers(params.groupId, signedIn && group.data !== undefined);

  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  if (me.isLoading || !me.data?.data.user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--color-ink-3)]">
        Loading…
      </div>
    );
  }

  const meData = me.data.data;
  const meUser = meData.user;
  if (!meUser) {
    return null;
  }
  const myUserId = meUser.id;
  const myDisplayName = meUser.name ?? meUser.email;

  return (
    <GroupPageShell me={meData} group={group}>
      {(detail) => {
        const { group: g, myMembership, caps } = detail;
        const archived = g.status === "archived";
        const canManage = caps.canUpdateMetadata;
        const myEntry: GroupMembership | null =
          members.data?.entries.find((e) => e.membership.userId === myUserId)?.membership ??
          myMembership ??
          null;

        return (
          <>
            <div className="mx-auto max-w-3xl px-5 py-8 md:px-8">
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
                  params={{ groupId: g.id }}
                  search={{}}
                  className="hover:text-[var(--color-ink-2)]"
                >
                  {g.name}
                </Link>
                <span aria-hidden="true">/</span>
                <span className="text-[var(--color-ink-2)]">People</span>
              </nav>

              <header className="mt-3 flex flex-col items-start gap-2 md:flex-row md:items-center md:gap-3">
                <h1 className="font-serif text-[28px] text-[var(--color-ink)] leading-tight">
                  People
                </h1>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  {canManage ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setMembersDialogOpen(true)}
                    >
                      <Settings size={12} aria-hidden /> Manage members
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button size="sm" variant="primary" onClick={() => setInviteOpen(true)}>
                      + Invite
                    </Button>
                  ) : null}
                </div>
              </header>

              {archived ? (
                <Callout tone="warn" title="This group is archived" className="mt-4">
                  Membership is read-only. Unarchive from group settings to make changes.
                </Callout>
              ) : null}

              {myEntry ? (
                <section className="mt-6" aria-labelledby="profile-heading">
                  <h2
                    id="profile-heading"
                    className="font-medium text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]"
                  >
                    Your profile in this group
                  </h2>
                  <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] p-3">
                    <AvatarUploader
                      group={g}
                      userId={myUserId}
                      currentAvatarUrl={myEntry.profile.avatarUrl}
                      name={myEntry.profile.nickname ?? myDisplayName}
                      publicOrigin={PUBLIC_AVATAR_ORIGIN}
                      disabled={archived}
                    />
                  </div>
                </section>
              ) : null}

              <section className="mt-6 space-y-2" aria-labelledby="members-heading">
                <h2
                  id="members-heading"
                  className="font-medium text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]"
                >
                  Members · {members.data?.entries.length ?? 0}
                </h2>
                {members.isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : (members.data?.entries.length ?? 0) === 0 ? (
                  <EmptyState
                    title="No members"
                    description="Once invitations are accepted, members appear here."
                  />
                ) : (
                  <ul
                    aria-label="Group members"
                    className="divide-y divide-[var(--color-rule)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)]"
                  >
                    {members.data?.entries.map((row) => (
                      <MemberRow
                        key={row.membership.userId}
                        membership={row.membership}
                        displayName={row.displayName}
                        isMe={row.membership.userId === myUserId}
                        avatarOrigin={PUBLIC_AVATAR_ORIGIN}
                      />
                    ))}
                  </ul>
                )}
              </section>

              {canManage ? (
                <div className="mt-6">
                  <InvitationsPanel
                    group={g}
                    enabled={signedIn && !archived}
                    onInvite={() => setInviteOpen(true)}
                  />
                </div>
              ) : null}

              {myEntry && !archived ? (
                <div className="mt-8 rounded-[var(--radius-md)] border border-[var(--color-rule)] border-dashed bg-[var(--color-surface-2)] p-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1 text-[12px] text-[var(--color-ink-3)]">
                      Leaving the group ends your access. Past activity records stay attributed
                      unless you anonymize.
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setLeaveOpen(true)}
                      className="shrink-0"
                    >
                      <LogOut size={12} aria-hidden /> Leave group
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            <GroupMembersDialog
              open={membersDialogOpen}
              group={g}
              onClose={() => setMembersDialogOpen(false)}
            />
            <InviteDialog open={inviteOpen} group={g} onClose={() => setInviteOpen(false)} />
            <LeaveGroupDialog open={leaveOpen} group={g} onClose={() => setLeaveOpen(false)} />
          </>
        );
      }}
    </GroupPageShell>
  );
}
