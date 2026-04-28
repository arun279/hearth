import type { GroupMembership } from "@hearth/domain";
import { Button, Callout, EmptyState, Skeleton } from "@hearth/ui";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { LogOut, Settings } from "lucide-react";
import { useState } from "react";
import { AvatarUploader } from "../components/groups/avatar-uploader.tsx";
import { GroupMembersDialog } from "../components/groups/group-members-dialog.tsx";
import { GroupPageShell } from "../components/groups/group-page-shell.tsx";
import { GroupSubpageBreadcrumb } from "../components/groups/group-subpage-breadcrumb.tsx";
import { InvitationsPanel } from "../components/groups/invitations-panel.tsx";
import { InviteDialog } from "../components/groups/invite-dialog.tsx";
import { LeaveGroupDialog } from "../components/groups/leave-group-dialog.tsx";
import { MemberRow } from "../components/groups/member-row.tsx";
import { useDocumentTitle } from "../hooks/use-document-title.ts";
import { useGroupMembers } from "../hooks/use-group-members.ts";
import { useGroup } from "../hooks/use-groups.ts";
import { useMeContext } from "../hooks/use-me-context.ts";
import { loadMeContextOrNull } from "../lib/me-context.ts";

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

  useDocumentTitle(["People", group.data?.group.name]);

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
  // Server-side truth for R2 public reads, scrubbed of trailing slash so
  // the join against the stored avatar key is well-formed regardless of
  // whether the operator pasted the bucket URL with or without one.
  const avatarOrigin = meData.instance.r2PublicOrigin.replace(/\/$/, "");

  return (
    <GroupPageShell me={meData} group={group}>
      {(detail) => {
        const { group: g, myMembership, caps } = detail;
        const archived = g.status === "archived";
        // The admin-side affordances are gated on `canManageMembership`
        // (and `canCreateInvitation`, which has identical authority
        // shape today) rather than `canUpdateMetadata`. The latter
        // requires Group Admin membership; the former includes Instance
        // Operators acting as the recovery path the policy was written
        // for.
        const canManage = caps.canManageMembership;
        const canInvite = caps.canCreateInvitation;
        const myEntry: GroupMembership | null =
          members.data?.entries.find((e) => e.membership.userId === myUserId)?.membership ??
          myMembership ??
          null;

        return (
          <>
            <div className="mx-auto max-w-3xl px-5 py-8 md:px-8">
              <GroupSubpageBreadcrumb groupId={g.id} groupName={g.name} currentLabel="People" />

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
                  {canInvite ? (
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
                    className="font-medium text-[11px] text-[var(--color-ink-3)] uppercase tracking-wide"
                  >
                    Your profile in this group
                  </h2>
                  <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] p-3">
                    <AvatarUploader
                      group={g}
                      userId={myUserId}
                      currentAvatarUrl={myEntry.profile.avatarUrl}
                      name={myEntry.profile.nickname ?? myDisplayName}
                      publicOrigin={avatarOrigin}
                      disabled={archived}
                    />
                  </div>
                </section>
              ) : null}

              <section className="mt-6 space-y-2" aria-labelledby="members-heading">
                <h2
                  id="members-heading"
                  className="font-medium text-[11px] text-[var(--color-ink-3)] uppercase tracking-wide"
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
                        avatarOrigin={avatarOrigin}
                      />
                    ))}
                  </ul>
                )}
              </section>

              {canInvite ? (
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
