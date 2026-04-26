import type { GroupMembership, LearningTrack, MeContext, StudyGroup } from "@hearth/domain";
import { Avatar, Badge, Button, Callout, EmptyState } from "@hearth/ui";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Plus, Settings } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { GroupPageShell } from "../components/groups/group-page-shell.tsx";
import { GroupSettingsDialog } from "../components/groups/group-settings-dialog.tsx";
import { CreateTrackDialog } from "../components/tracks/create-track-dialog.tsx";
import { useDocumentTitle } from "../hooks/use-document-title.ts";
import type { GroupCaps } from "../hooks/use-groups.ts";
import { useGroup } from "../hooks/use-groups.ts";
import { useMeContext } from "../hooks/use-me-context.ts";
import { useCreateTrack, useTracksInGroup } from "../hooks/use-tracks.ts";
import { loadMeContextOrNull } from "../lib/me-context.ts";

const searchSchema = z.object({
  settings: z.enum(["open"]).optional(),
  newTrack: z.enum(["open"]).optional(),
});

export const Route = createFileRoute("/g/$groupId")({
  validateSearch: searchSchema,
  beforeLoad: async ({ context }) => {
    const me = await loadMeContextOrNull(context.queryClient);
    if (!me?.user) {
      throw redirect({ to: "/", search: {} });
    }
  },
  component: GroupHome,
});

function GroupHome() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const me = useMeContext();
  const signedIn = me.data?.data.user !== null && me.data?.data.user !== undefined;
  const group = useGroup(params.groupId, signedIn);

  useDocumentTitle([group.data?.group.name]);

  const [settingsOpenLocal, setSettingsOpenLocal] = useState(false);
  const [newTrackOpenLocal, setNewTrackOpenLocal] = useState(false);
  // Allow `?settings=open` / `?newTrack=open` to deep-link the dialogs
  // open. Closing strips the param so the URL doesn't keep modals "stuck
  // open" on navigation back.
  const settingsOpen = settingsOpenLocal || search.settings === "open";
  const newTrackOpen = newTrackOpenLocal || search.newTrack === "open";

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

  return (
    <GroupPageShell me={meData} group={group}>
      {(detail) => (
        <>
          <GroupHomeBody
            g={detail.group}
            caps={detail.caps}
            counts={detail.counts}
            myMembership={detail.myMembership}
            meUser={meUser}
            onOpenSettings={() => setSettingsOpenLocal(true)}
            onOpenNewTrack={() => setNewTrackOpenLocal(true)}
          />
          <GroupSettingsDialog
            open={settingsOpen}
            group={detail.group}
            caps={detail.caps}
            onClose={() => {
              setSettingsOpenLocal(false);
              if (search.settings) {
                void navigate({ search: {} });
              }
            }}
          />
          <CreateTrackForGroupDialog
            open={newTrackOpen}
            groupId={detail.group.id}
            onClose={() => {
              setNewTrackOpenLocal(false);
              if (search.newTrack) {
                void navigate({ search: {} });
              }
            }}
          />
        </>
      )}
    </GroupPageShell>
  );
}

function CreateTrackForGroupDialog({
  open,
  groupId,
  onClose,
}: {
  readonly open: boolean;
  readonly groupId: string;
  readonly onClose: () => void;
}) {
  const navigate = Route.useNavigate();
  const create = useCreateTrack(groupId);
  return (
    <CreateTrackDialog
      open={open}
      onClose={onClose}
      onCreate={async (input) => {
        const track = await create.mutateAsync(input);
        toast.success(`Created "${track.name}".`);
        onClose();
        // Land the user on the new track's home so the next step (compose
        // the first activity, invite collaborators) is one click away.
        void navigate({
          to: "/g/$groupId/t/$trackId",
          params: { groupId, trackId: track.id },
          search: {},
        });
      }}
    />
  );
}

type GroupHomeBodyProps = {
  readonly g: StudyGroup;
  readonly caps: GroupCaps;
  readonly counts: { memberCount: number; trackCount: number; libraryItemCount: number };
  readonly myMembership: GroupMembership | null;
  readonly meUser: NonNullable<MeContext["data"]["user"]>;
  readonly onOpenSettings: () => void;
  readonly onOpenNewTrack: () => void;
};

function GroupHomeBody({
  g,
  caps,
  counts,
  myMembership,
  meUser,
  onOpenSettings,
  onOpenNewTrack,
}: GroupHomeBodyProps) {
  const archived = g.status === "archived";
  const myRole = myMembership?.role ?? null;
  const tracksQuery = useTracksInGroup(g.id, true);
  const tracks = tracksQuery.data ?? [];

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
        <span className="truncate text-[var(--color-ink-2)]">{g.name}</span>
      </nav>

      <header className="mt-3 space-y-3">
        <div className="flex flex-col items-start gap-2 md:flex-row md:items-start md:gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-[28px] text-[var(--color-ink)] leading-tight">
              {g.name}
            </h1>
            {g.description ? (
              <p className="mt-1 text-[13px] text-[var(--color-ink-2)]">{g.description}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {archived ? <Badge tone="warn">archived</Badge> : <Badge tone="good">active</Badge>}
            <Badge>{g.admissionPolicy.replace("_", " ")}</Badge>
          </div>
        </div>

        {caps.canArchive || caps.canUnarchive || caps.canUpdateMetadata ? (
          <div>
            <Button variant="secondary" size="sm" onClick={onOpenSettings}>
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
        <div className="flex items-center gap-3">
          <h2
            id="tracks-heading"
            className="font-medium text-[11px] text-[var(--color-ink-3)] uppercase tracking-wide"
          >
            Learning Tracks · {counts.trackCount}
          </h2>
          {myRole === "admin" && !archived ? (
            <Button
              variant="secondary"
              size="sm"
              className="ml-auto"
              onClick={onOpenNewTrack}
              aria-label="Create a Learning Track"
            >
              <Plus size={12} strokeWidth={1.75} aria-hidden="true" />
              New track
            </Button>
          ) : null}
        </div>
        {tracks.length > 0 ? (
          <ul
            aria-label="Learning Tracks"
            className="divide-y divide-[var(--color-rule)] rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)]"
          >
            {tracks.map((t) => (
              <TrackRow key={t.id} track={t} />
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No tracks yet"
            description={
              myRole === "admin"
                ? "Create the first Learning Track to organise activities for this group."
                : "Your Group Admin hasn't created a Learning Track yet."
            }
          />
        )}
      </section>

      <section className="mt-6 space-y-2" aria-labelledby="people-heading">
        <div className="flex items-center gap-3">
          <h2
            id="people-heading"
            className="font-medium text-[11px] text-[var(--color-ink-3)] uppercase tracking-wide"
          >
            People · {counts.memberCount}
          </h2>
          <Link
            to="/g/$groupId/people"
            params={{ groupId: g.id }}
            className="ml-auto text-[12px] text-[var(--color-accent)] hover:underline"
          >
            Open People →
          </Link>
        </div>
        {myMembership && meUser ? (
          <ul
            aria-label="Group members"
            className="divide-y divide-[var(--color-rule)] rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)]"
          >
            <li className="flex items-center gap-3 px-3 py-2.5">
              <Avatar name={meUser.name ?? meUser.email} src={meUser.image ?? null} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-[13px] text-[var(--color-ink)]">
                    {meUser.name ?? meUser.email}
                  </span>
                  <Badge tone="accent">you</Badge>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-[var(--color-ink-3)]">
                  {myMembership.role === "admin" ? "Group Admin" : "Member"}
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
          className="font-medium text-[11px] text-[var(--color-ink-3)] uppercase tracking-wide"
        >
          Library · {counts.libraryItemCount}
        </h2>
        <EmptyState
          title="The shared Library is empty"
          description="Stewards upload PDFs, audio, and other materials here once the Library aggregate ships."
        />
      </section>
    </div>
  );
}

const TRACK_STATUS_TONE: Record<LearningTrack["status"], "good" | "warn" | "neutral"> = {
  active: "good",
  paused: "warn",
  archived: "neutral",
};

function TrackRow({ track }: { readonly track: LearningTrack }) {
  return (
    <li>
      <Link
        to="/g/$groupId/t/$trackId"
        params={{ groupId: track.groupId, trackId: track.id }}
        search={{}}
        className="flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-surface-2)] focus-visible:outline-none"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-[13px] text-[var(--color-ink)]">
              {track.name}
            </span>
            <Badge tone={TRACK_STATUS_TONE[track.status]}>{track.status}</Badge>
          </div>
          {track.description ? (
            <div className="mt-0.5 line-clamp-1 text-[12px] text-[var(--color-ink-2)]">
              {track.description}
            </div>
          ) : null}
        </div>
        <span aria-hidden="true" className="text-[12px] text-[var(--color-ink-3)]">
          →
        </span>
      </Link>
    </li>
  );
}
