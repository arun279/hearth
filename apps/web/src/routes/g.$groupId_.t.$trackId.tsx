import type { ContributionMode, LearningTrack, MeContext, TrackEnrollment } from "@hearth/domain";
import {
  AvatarStack,
  Badge,
  type BadgeTone,
  Button,
  Callout,
  EmptyState,
  panelIdFor,
  TabBar,
  tabIdFor,
} from "@hearth/ui";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { LogOut, Plus, Settings, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { LeaveTrackDialog } from "../components/tracks/leave-track-dialog.tsx";
import { TrackPageShell } from "../components/tracks/track-page-shell.tsx";
import { TrackSettingsDialog } from "../components/tracks/track-settings-dialog.tsx";
import { useDocumentTitle } from "../hooks/use-document-title.ts";
import { useMeContext } from "../hooks/use-me-context.ts";
import {
  type TrackDetail,
  type TrackSummaryCounts,
  useEnrollInTrack,
  useTrack,
  useTrackSummary,
} from "../hooks/use-tracks.ts";
import { loadMeContextOrNull } from "../lib/me-context.ts";
import { asUserMessage } from "../lib/problem.ts";

const searchSchema = z.object({
  tab: z.enum(["activities", "sessions", "library", "pending"]).optional(),
  settings: z.enum(["open"]).optional(),
});

type TrackTab = "activities" | "sessions" | "library" | "pending";

const TAB_PREFIX = "track-home";

export const Route = createFileRoute("/g/$groupId_/t/$trackId")({
  validateSearch: searchSchema,
  beforeLoad: async ({ context }) => {
    const me = await loadMeContextOrNull(context.queryClient);
    if (!me?.user) {
      throw redirect({ to: "/", search: {} });
    }
  },
  component: TrackHome,
});

function TrackHome() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const me = useMeContext();
  const signedIn = me.data?.data.user !== null && me.data?.data.user !== undefined;
  const trackQuery = useTrack(params.trackId, signedIn);
  // The summary query depends on the groupId (URL-supplied) and the
  // trackId; once trackQuery resolves we'll know the canonical group, but
  // the URL-supplied one matches in the happy path. Gate behind signedIn
  // so we don't fire while logging in.
  const summaryQuery = useTrackSummary(params.groupId, params.trackId, signedIn);
  const r2PublicOrigin = me.data?.data.instance.r2PublicOrigin ?? "";

  useDocumentTitle([trackQuery.data?.track.name, trackQuery.data?.group.name]);

  const [settingsOpenLocal, setSettingsOpenLocal] = useState(false);
  const settingsOpen = settingsOpenLocal || search.settings === "open";
  const activeTab: TrackTab = search.tab ?? "activities";

  if (me.isLoading || !me.data?.data.user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--color-ink-3)]">
        Loading…
      </div>
    );
  }

  return (
    <TrackPageShell me={me.data.data} track={trackQuery}>
      {(detail) => (
        <>
          <TrackHomeBody
            detail={detail}
            meUser={me.data?.data.user ?? null}
            r2PublicOrigin={r2PublicOrigin}
            activeTab={activeTab}
            counts={summaryQuery.data}
            onChangeTab={(tab) => {
              void navigate({
                search: {
                  ...(tab === "activities" ? {} : { tab }),
                  ...(settingsOpen ? { settings: "open" as const } : {}),
                },
              });
            }}
            onOpenSettings={() => setSettingsOpenLocal(true)}
          />
          <TrackSettingsDialog
            open={settingsOpen}
            onClose={() => {
              setSettingsOpenLocal(false);
              if (search.settings) {
                void navigate({
                  search: { ...(activeTab === "activities" ? {} : { tab: activeTab }) },
                });
              }
            }}
            track={detail.track}
            groupId={detail.group.id}
            contributionPolicy={detail.contributionPolicy}
            caps={detail.caps}
          />
        </>
      )}
    </TrackPageShell>
  );
}

type TrackHomeBodyProps = {
  readonly detail: TrackDetail;
  readonly meUser: MeContext["data"]["user"];
  readonly r2PublicOrigin: string;
  readonly activeTab: TrackTab;
  readonly counts: TrackSummaryCounts | undefined;
  readonly onChangeTab: (tab: TrackTab) => void;
  readonly onOpenSettings: () => void;
};

/**
 * Group-profile avatars are stored as bare R2 keys; OAuth-supplied user
 * images are already absolute URLs. Join the key with the public origin
 * (taken from `me.instance.r2PublicOrigin` so the SPA never has a parallel
 * env var that can drift) and fall back to the OAuth image only when no
 * group-profile avatar exists. Mirrors the join in `member-row.tsx`.
 */
function resolveAvatarSrc(
  storageKey: string | null,
  oauthImage: string | null,
  publicOrigin: string,
): string | null {
  if (storageKey !== null && storageKey.length > 0) {
    const origin = publicOrigin.replace(/\/$/, "");
    return origin.length > 0 ? `${origin}/${storageKey}` : storageKey;
  }
  return oauthImage;
}

function TrackHomeBody({
  detail,
  meUser,
  r2PublicOrigin,
  activeTab,
  counts,
  onChangeTab,
  onOpenSettings,
}: TrackHomeBodyProps) {
  const { track, group, caps, contributionPolicy } = detail;
  const enroll = useEnrollInTrack(group.id, track.id);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const myEnrollment = detail.myEnrollment;
  const isCurrentEnrollee = myEnrollment !== null && myEnrollment.leftAt === null;
  const myMembership = detail.myGroupMembership;
  const isCurrentMember = myMembership !== null && myMembership.removedAt === null;
  // Self-enroll is offered when: actor is a current group member, NOT
  // currently enrolled, and the track / group are not archived. The
  // policy server-checks; this is a UI gate that mirrors the predicate.
  const canSelfEnroll =
    isCurrentMember &&
    !isCurrentEnrollee &&
    track.status !== "archived" &&
    group.status !== "archived";
  const facilitatorCount = counts?.facilitatorCount ?? 0;
  // Last facilitator on an active track can't leave without orphaning —
  // the server returns 409 in that case; we surface a disabled UI hint
  // to avoid the failed mutation round-trip.
  const isLastFacilitator =
    isCurrentEnrollee &&
    myEnrollment.role === "facilitator" &&
    track.status === "active" &&
    facilitatorCount <= 1;
  const groupArchived = group.status === "archived";
  const trackArchived = track.status === "archived";
  const trackPaused = track.status === "paused";
  const policyMode = contributionPolicy.data.mode;
  // Hide the Pending tab when the policy is "none" AND the viewer isn't a
  // facilitator — non-facilitators have no path to land work in pending,
  // so the empty surface is misleading. Facilitators always see it so
  // they can flip the policy and view legacy queue state.
  const showPendingTab =
    policyMode !== "none" || caps.canEditContributionPolicy || caps.canEditMetadata;

  // Settings affordance lights up when the dialog has at least one
  // *state-changing* action available. `canArchive` is intentionally
  // excluded — archive is idempotent (re-archiving an archived track is a
  // no-op), so on an archived track every other cap collapses to false and
  // showing the button alone would open an empty-room dialog.
  const settingsAffordance =
    caps.canEditMetadata || caps.canEditContributionPolicy || caps.canPause || caps.canResume;

  const tabs: ReadonlyArray<{
    readonly value: TrackTab;
    readonly label: string;
    readonly count?: number;
  }> = [
    { value: "activities", label: "Activities", count: counts?.activityCount },
    { value: "sessions", label: "Sessions", count: counts?.sessionCount },
    { value: "library", label: "Library", count: counts?.libraryItemCount },
    ...(showPendingTab
      ? ([
          {
            value: "pending" as const,
            label: "Pending",
            count: counts?.pendingContributionCount,
          },
        ] as const)
      : []),
  ];

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 md:px-8">
      {groupArchived ? (
        <Callout tone="warn" title="The parent group is archived" className="mb-4">
          Tracks inside an archived group are read-only. A Group Admin can unarchive the group to
          resume work.
        </Callout>
      ) : trackArchived ? (
        <Callout tone="neutral" title="Archived" className="mb-4">
          This Learning Track is read-only. Archive is terminal — history is preserved.
        </Callout>
      ) : trackPaused ? (
        <Callout tone="warn" title="Paused" className="mb-4">
          No new activities or sessions will be created until this track is resumed. Existing work
          remains readable.
        </Callout>
      ) : null}

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
          params={{ groupId: group.id }}
          search={{}}
          className="truncate hover:text-[var(--color-ink-2)]"
        >
          {group.name}
        </Link>
        {/* Current-page entry hidden below md — the 28px serif title
            renders the track name in full directly below the breadcrumb,
            so showing it here too would force a redundant truncation. */}
        <span aria-hidden="true" className="hidden md:inline">
          /
        </span>
        <span className="hidden truncate text-[var(--color-ink-2)] md:inline">{track.name}</span>
      </nav>

      <header className="mt-3 space-y-3">
        <div className="flex flex-col items-start gap-2 md:flex-row md:items-start md:gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="font-serif text-[28px] text-[var(--color-ink)] leading-tight">
                {track.name}
              </h1>
              <TrackStatusBadge status={track.status} />
            </div>
            {track.description ? (
              <p className="mt-1 text-[13px] text-[var(--color-ink-2)]">{track.description}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {canSelfEnroll ? (
              <Button
                variant="primary"
                size="sm"
                disabled={enroll.isPending}
                onClick={async () => {
                  try {
                    await enroll.mutateAsync({});
                    toast.success(`Enrolled in ${track.name}.`);
                  } catch (err) {
                    toast.error(asUserMessage(err, "Couldn't enroll."));
                  }
                }}
              >
                <Plus size={12} strokeWidth={1.75} aria-hidden="true" />
                {enroll.isPending ? "Enrolling…" : "Enroll"}
              </Button>
            ) : null}
            {isCurrentEnrollee && group.status !== "archived" ? (
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
                Leave
              </Button>
            ) : null}
            <Link
              to="/g/$groupId/t/$trackId/people"
              params={{ groupId: group.id, trackId: track.id }}
              className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-rule)] bg-[var(--color-surface)] px-2.5 text-[12px] text-[var(--color-ink-2)] hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            >
              <Users size={12} strokeWidth={1.75} aria-hidden="true" />
              People
            </Link>
            {settingsAffordance ? (
              <Button variant="secondary" size="sm" onClick={onOpenSettings}>
                <Settings size={12} strokeWidth={1.75} aria-hidden="true" />
                Track settings
              </Button>
            ) : null}
          </div>
        </div>

        <FacilitatorBar
          enrollmentCount={counts?.enrollmentCount ?? 0}
          facilitatorCount={counts?.facilitatorCount ?? 0}
          myEnrollment={detail.myEnrollment}
          myDisplayName={
            detail.myGroupMembership?.profile.nickname ?? meUser?.name ?? meUser?.email ?? null
          }
          myAvatarSrc={resolveAvatarSrc(
            detail.myGroupMembership?.profile.avatarUrl ?? null,
            meUser?.image ?? null,
            r2PublicOrigin,
          )}
        />
      </header>

      {/* The hero's "Up next" callout from the design prototype lands when
          the Sessions surface ships in M13 — until then we hide the section
          entirely rather than render a placeholder that reads as broken. */}

      <section className="mt-6">
        <TabBar
          ariaLabel="Track sections"
          idPrefix={TAB_PREFIX}
          value={activeTab}
          items={tabs.map((tab) => ({
            value: tab.value,
            label: tab.label,
            badge:
              tab.count !== undefined && tab.count > 0 ? (
                <TabCounter count={tab.count} />
              ) : undefined,
          }))}
          onChange={onChangeTab}
        />

        <div
          role="tabpanel"
          id={panelIdFor(TAB_PREFIX)}
          aria-labelledby={tabIdFor(TAB_PREFIX, activeTab)}
          className="pt-5"
        >
          {activeTab === "activities" ? <ActivitiesEmpty /> : null}
          {activeTab === "sessions" ? <SessionsEmpty /> : null}
          {activeTab === "library" ? <LibraryEmpty groupId={group.id} /> : null}
          {activeTab === "pending" && showPendingTab ? (
            <PendingEmpty mode={policyMode} status={track.status} />
          ) : null}
        </div>
      </section>

      <LeaveTrackDialog
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        groupId={group.id}
        track={track}
      />
    </div>
  );
}

const STATUS_TONE: Record<LearningTrack["status"], BadgeTone> = {
  active: "good",
  paused: "warn",
  archived: "neutral",
};

function TrackStatusBadge({ status }: { readonly status: LearningTrack["status"] }) {
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>;
}

function TabCounter({ count }: { readonly count: number }) {
  return (
    <span
      aria-hidden="true"
      className="ml-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-[var(--color-warn-soft)] px-1.5 font-mono font-semibold text-[10px] text-[var(--color-warn)]"
    >
      {count}
    </span>
  );
}

function FacilitatorBar({
  enrollmentCount,
  facilitatorCount,
  myEnrollment,
  myDisplayName,
  myAvatarSrc,
}: {
  readonly enrollmentCount: number;
  readonly facilitatorCount: number;
  readonly myEnrollment: TrackEnrollment | null;
  readonly myDisplayName: string | null;
  readonly myAvatarSrc: string | null;
}) {
  // We render the viewer's own avatar when they hold an active facilitator
  // enrollment — covers the M4 happy path (the creator is the only
  // facilitator) without an extra round trip. M5 will lift the full
  // roster into the response and this collapses into a one-liner that
  // maps the entries through `AvatarStack`. Until then, a viewer who is
  // not a facilitator sees only the count, which is honest about what we
  // know.
  const viewerIsFacilitator =
    myEnrollment !== null && myEnrollment.leftAt === null && myEnrollment.role === "facilitator";

  const entries =
    viewerIsFacilitator && myDisplayName
      ? [{ key: "me", name: myDisplayName, src: myAvatarSrc }]
      : [];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--color-ink-2)]">
      <div className="flex items-center gap-2">
        <span className="text-[var(--color-ink-3)]">Facilitators</span>
        {entries.length > 0 ? (
          <AvatarStack
            entries={entries}
            ariaLabel={`Facilitators: ${entries.map((e) => e.name).join(", ")}`}
            size={20}
          />
        ) : null}
        <span className="font-mono tabular-nums">{facilitatorCount}</span>
      </div>
      <span aria-hidden="true" className="text-[var(--color-ink-3)]">
        ·
      </span>
      <div>
        <span className="text-[var(--color-ink-3)]">Enrolled </span>
        <span className="font-mono tabular-nums">{enrollmentCount}</span>
      </div>
    </div>
  );
}

function ActivitiesEmpty() {
  return (
    <EmptyState
      title="No activities yet"
      description="Learning Activities — the things participants actually do — appear here. Composing them lands shortly."
    />
  );
}

function SessionsEmpty() {
  return (
    <EmptyState
      title="No sessions scheduled"
      description="Sessions are scheduled meet-ups attached to this track. They appear here as the calendar fills out."
    />
  );
}

function LibraryEmpty({ groupId }: { readonly groupId: string }) {
  return (
    <EmptyState
      title="No materials linked"
      description="Library Items used in this track's activities appear here."
      action={
        <Link
          to="/g/$groupId"
          params={{ groupId }}
          search={{}}
          className="text-[12px] text-[var(--color-accent)] hover:underline"
        >
          Open the group Library →
        </Link>
      }
    />
  );
}

function PendingEmpty({
  mode,
  status,
}: {
  readonly mode: ContributionMode;
  readonly status: LearningTrack["status"];
}) {
  // Project the empty-state copy through the track's terminal-state
  // membership: an archived or paused track can no longer accept new
  // contributions regardless of policy, so the policy-mode copy below would
  // be misleading. The status check wins.
  if (status === "archived") {
    return (
      <EmptyState
        title="No pending contributions"
        description="Archived — contributions are no longer accepted on this track. The pending queue is final."
      />
    );
  }
  if (status === "paused") {
    return (
      <EmptyState
        title="No pending contributions"
        description="Paused — new contributions are blocked until a facilitator resumes the track."
      />
    );
  }
  const description =
    mode === "required_review"
      ? "Required review is on — every participant contribution lands here for facilitator approval."
      : mode === "optional_review"
        ? "Optional review is on — participants can choose to send a contribution here."
        : mode === "none"
          ? "Only facilitators can publish to this track. The pending queue stays empty."
          : "Direct publish is on — contributions skip review. This queue stays empty unless a facilitator changes the policy.";
  return <EmptyState title="No pending contributions" description={description} />;
}
