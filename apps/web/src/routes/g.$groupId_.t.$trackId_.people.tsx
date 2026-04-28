import type { TrackEnrollment } from "@hearth/domain";
import { Button, Callout, EmptyState, Skeleton } from "@hearth/ui";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { LogOut, Shield, ShieldOff, UserMinus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "../components/admin/confirm-action-dialog.tsx";
import { LeaveTrackDialog } from "../components/tracks/leave-track-dialog.tsx";
import { TrackEnrolleeRow } from "../components/tracks/track-enrollee-row.tsx";
import { TrackPageShell } from "../components/tracks/track-page-shell.tsx";
import { useDocumentTitle } from "../hooks/use-document-title.ts";
import { useMeContext } from "../hooks/use-me-context.ts";
import {
  type TrackEnrolleeRow as TrackEnrolleeRowData,
  useAssignTrackFacilitator,
  useRemoveTrackEnrollment,
  useRemoveTrackFacilitator,
  useTrack,
  useTrackPeople,
} from "../hooks/use-tracks.ts";
import { loadMeContextOrNull } from "../lib/me-context.ts";
import { asUserMessage } from "../lib/problem.ts";

export const Route = createFileRoute("/g/$groupId_/t/$trackId_/people")({
  beforeLoad: async ({ context }) => {
    const me = await loadMeContextOrNull(context.queryClient);
    if (!me?.user) {
      throw redirect({ to: "/", search: {} });
    }
  },
  component: TrackPeopleRoute,
});

function TrackPeopleRoute() {
  const params = Route.useParams();
  const me = useMeContext();
  const signedIn = me.data?.data.user !== null && me.data?.data.user !== undefined;
  const trackQuery = useTrack(params.trackId, signedIn);
  const peopleQuery = useTrackPeople(params.trackId, signedIn && trackQuery.data !== undefined);

  useDocumentTitle(["People", trackQuery.data?.track.name, trackQuery.data?.group.name]);

  if (me.isLoading || !me.data?.data.user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--color-ink-3)]">
        Loading…
      </div>
    );
  }

  return (
    <TrackPageShell me={me.data.data} track={trackQuery}>
      {(detail) => {
        const myUserId = me.data?.data.user?.id ?? null;
        const avatarOrigin = (me.data?.data.instance.r2PublicOrigin ?? "").replace(/\/$/, "");
        return (
          <TrackPeopleBody
            groupId={detail.group.id}
            trackId={detail.track.id}
            trackName={detail.track.name}
            trackStatus={detail.track.status}
            myEnrollment={detail.myEnrollment}
            myUserId={myUserId}
            avatarOrigin={avatarOrigin}
            people={peopleQuery.data}
            isLoading={peopleQuery.isLoading}
            isError={peopleQuery.isError}
          />
        );
      }}
    </TrackPageShell>
  );
}

type TrackPeopleBodyProps = {
  readonly groupId: string;
  readonly trackId: string;
  readonly trackName: string;
  readonly trackStatus: "active" | "paused" | "archived";
  readonly myEnrollment: TrackEnrollment | null;
  readonly myUserId: string | null;
  readonly avatarOrigin: string;
  readonly people:
    | {
        readonly facilitatorCount: number;
        readonly entries: readonly TrackEnrolleeRowData[];
        readonly leftEntries: readonly TrackEnrolleeRowData[];
      }
    | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
};

function TrackPeopleBody({
  groupId,
  trackId,
  trackName,
  trackStatus,
  myEnrollment,
  myUserId,
  avatarOrigin,
  people,
  isLoading,
  isError,
}: TrackPeopleBodyProps) {
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [confirming, setConfirming] = useState<ConfirmingState | null>(null);

  const promote = useAssignTrackFacilitator(groupId, trackId);
  const demote = useRemoveTrackFacilitator(groupId, trackId);
  const remove = useRemoveTrackEnrollment(groupId, trackId);

  const isCurrentEnrollee = myEnrollment !== null && myEnrollment.leftAt === null;
  const facilitatorCount = people?.facilitatorCount ?? 0;
  const isLastFacilitator =
    isCurrentEnrollee &&
    myEnrollment.role === "facilitator" &&
    trackStatus === "active" &&
    facilitatorCount <= 1;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-5 py-8 md:px-8">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError || !people) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-12 md:px-8">
        <EmptyState
          title="Couldn't load people"
          description="Try refreshing — the list reads from the track itself, so an empty result usually means a transient error."
        />
      </div>
    );
  }

  const facilitators = people.entries.filter((e) => e.enrollment.role === "facilitator");
  const participants = people.entries.filter((e) => e.enrollment.role === "participant");

  return (
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
          to="/g/$groupId/t/$trackId"
          params={{ groupId, trackId }}
          search={{}}
          className="truncate hover:text-[var(--color-ink-2)]"
        >
          {trackName}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-[var(--color-ink-2)]">People</span>
      </nav>

      <header className="mt-3">
        <h1 className="font-serif text-[28px] text-[var(--color-ink)] leading-tight">People</h1>
        <p className="mt-1 text-[13px] text-[var(--color-ink-2)]">
          Facilitators curate this Learning Track; enrollees take part.
        </p>
      </header>

      <PeopleSection
        ariaLabel="Facilitators"
        heading={`Facilitators · ${facilitators.length}`}
        rows={facilitators}
        myUserId={myUserId}
        avatarOrigin={avatarOrigin}
        onConfirm={setConfirming}
        emptyTitle="No facilitators"
        emptyDescription="An active track must have at least one facilitator. A Group Admin can promote one."
      />

      <PeopleSection
        ariaLabel="Participants"
        heading={`Enrolled · ${participants.length}`}
        rows={participants}
        myUserId={myUserId}
        avatarOrigin={avatarOrigin}
        onConfirm={setConfirming}
        emptyTitle="No participants yet"
        emptyDescription="Members of the parent group can self-enroll, or a facilitator can pull them in."
      />

      {people.leftEntries.length > 0 ? (
        <PeopleSection
          ariaLabel="Past enrollees"
          heading={`Past enrollees · ${people.leftEntries.length}`}
          rows={people.leftEntries}
          myUserId={myUserId}
          avatarOrigin={avatarOrigin}
          onConfirm={setConfirming}
          // Already-left rows render the row + role pill but no actions —
          // re-enrolling brings them back via the standard enroll path.
          renderActions={false}
        />
      ) : null}

      {isCurrentEnrollee ? (
        <Callout tone="neutral" className="mt-6">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[12px] text-[var(--color-ink-3)]">
              Leaving the track preserves your past activity records.
            </p>
            <Button
              variant="secondary"
              size="sm"
              disabled={isLastFacilitator}
              title={
                isLastFacilitator
                  ? "You're the only facilitator. Promote a replacement first."
                  : undefined
              }
              onClick={() => setLeaveOpen(true)}
            >
              <LogOut size={12} strokeWidth={1.75} aria-hidden="true" />
              Leave {trackName}
            </Button>
          </div>
        </Callout>
      ) : null}

      <LeaveTrackDialog
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        groupId={groupId}
        track={{
          id: trackId as never,
          groupId: groupId as never,
          name: trackName,
          description: null,
          status: trackStatus,
          pausedAt: null,
          archivedAt: null,
          archivedBy: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        }}
      />

      <ConfirmActionDialog
        open={confirming?.kind === "promote"}
        title="Promote to facilitator?"
        description={
          confirming?.kind === "promote"
            ? `${confirming.row.displayName} will be able to edit this track's structure and review pending contributions.`
            : undefined
        }
        confirmLabel={promote.isPending ? "Promoting…" : "Promote"}
        tone="primary"
        pending={promote.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          if (confirming?.kind !== "promote") return;
          try {
            await promote.mutateAsync(confirming.row.enrollment.userId);
            toast.success(`${confirming.row.displayName} is now a facilitator.`);
            setConfirming(null);
          } catch (err) {
            toast.error(asUserMessage(err, "Couldn't promote."));
          }
        }}
      />

      <ConfirmActionDialog
        open={confirming?.kind === "demote"}
        title="Demote to participant?"
        description={
          confirming?.kind === "demote"
            ? `${confirming.row.displayName} will lose facilitator privileges. Their participant access remains.`
            : undefined
        }
        confirmLabel={demote.isPending ? "Demoting…" : "Demote"}
        tone="primary"
        pending={demote.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          if (confirming?.kind !== "demote") return;
          try {
            await demote.mutateAsync(confirming.row.enrollment.userId);
            toast.success(`${confirming.row.displayName} is now a participant.`);
            setConfirming(null);
          } catch (err) {
            toast.error(asUserMessage(err, "Couldn't demote."));
          }
        }}
      />

      <ConfirmActionDialog
        open={confirming?.kind === "remove"}
        title="Remove from track?"
        description={
          confirming?.kind === "remove"
            ? `${confirming.row.displayName} will lose access to this track. Their existing activity records stay preserved.`
            : undefined
        }
        confirmLabel={remove.isPending ? "Removing…" : "Remove"}
        tone="destructive"
        pending={remove.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          if (confirming?.kind !== "remove") return;
          try {
            await remove.mutateAsync(confirming.row.enrollment.userId);
            toast.success(`${confirming.row.displayName} removed from ${trackName}.`);
            setConfirming(null);
          } catch (err) {
            toast.error(asUserMessage(err, "Couldn't remove."));
          }
        }}
      />
    </div>
  );
}

function SectionHeading({ children }: { readonly children: React.ReactNode }) {
  return (
    <h2 className="mt-6 mb-2 font-medium text-[11px] text-[var(--color-ink-3)] uppercase tracking-wide">
      {children}
    </h2>
  );
}

type ConfirmingState =
  | { kind: "promote"; row: TrackEnrolleeRowData }
  | { kind: "demote"; row: TrackEnrolleeRowData }
  | { kind: "remove"; row: TrackEnrolleeRowData };

function PeopleSection({
  ariaLabel,
  heading,
  rows,
  myUserId,
  avatarOrigin,
  onConfirm,
  emptyTitle,
  emptyDescription,
  renderActions = true,
}: {
  readonly ariaLabel: string;
  readonly heading: string;
  readonly rows: readonly TrackEnrolleeRowData[];
  readonly myUserId: string | null;
  readonly avatarOrigin: string;
  readonly onConfirm: (state: ConfirmingState) => void;
  readonly emptyTitle?: string;
  readonly emptyDescription?: string;
  readonly renderActions?: boolean;
}) {
  return (
    <>
      <SectionHeading>{heading}</SectionHeading>
      {rows.length > 0 ? (
        <ul
          aria-label={ariaLabel}
          className="divide-y divide-[var(--color-rule)] rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)]"
        >
          {rows.map((row) => (
            <TrackEnrolleeRow
              key={row.enrollment.userId}
              enrollment={row.enrollment}
              displayName={row.displayName}
              avatarUrl={row.avatarUrl}
              avatarOrigin={avatarOrigin}
              isMe={row.enrollment.userId === myUserId}
              actions={
                renderActions ? (
                  <RowActions
                    row={row}
                    onPromote={() => onConfirm({ kind: "promote", row })}
                    onDemote={() => onConfirm({ kind: "demote", row })}
                    onRemove={() => onConfirm({ kind: "remove", row })}
                  />
                ) : undefined
              }
            />
          ))}
        </ul>
      ) : emptyTitle ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : null}
    </>
  );
}

function RowActions({
  row,
  onPromote,
  onDemote,
  onRemove,
}: {
  readonly row: TrackEnrolleeRowData;
  readonly onPromote: () => void;
  readonly onDemote: () => void;
  readonly onRemove: () => void;
}) {
  const { capabilities } = row;
  return (
    <>
      {capabilities.canPromote ? (
        <Button variant="secondary" size="sm" onClick={onPromote} aria-label="Promote">
          <Shield size={12} strokeWidth={1.75} aria-hidden="true" />
          Promote
        </Button>
      ) : null}
      {capabilities.canDemote ? (
        <Button variant="secondary" size="sm" onClick={onDemote} aria-label="Demote">
          <ShieldOff size={12} strokeWidth={1.75} aria-hidden="true" />
          Demote
        </Button>
      ) : null}
      {capabilities.canRemove ? (
        <Button variant="secondary" size="sm" onClick={onRemove} aria-label="Remove">
          <UserMinus size={12} strokeWidth={1.75} aria-hidden="true" />
          Remove
        </Button>
      ) : null}
    </>
  );
}
