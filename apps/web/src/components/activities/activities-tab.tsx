import { Button, Callout, EmptyState, Modal, Skeleton } from "@hearth/ui";
import { Plus, Trash2 } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";
import {
  type ActivityComposerPayload,
  type ActivityListItem,
  useActivity,
  useCreateActivity,
  useDeleteActivity,
  useTrackActivities,
  useUpdateActivity,
} from "../../hooks/use-activities.ts";
import { asUserMessage } from "../../lib/problem.ts";
import { ConfirmActionDialog } from "../admin/confirm-action-dialog.tsx";
import { ActivityRow } from "./activity-row.tsx";

// Lazy-load the composer chunk so participants viewing the Activities
// tab don't pay its bundle cost until a facilitator clicks "+ New
// activity" or opens a row. The composer carries the Modal primitive,
// the audience roster, the library picker hook, and the radio + check-
// list components — none of which the read-only row view needs.
// Mounted conditionally below (`createOpen ? <Suspense>...</Suspense>
// : null`) so the dynamic import fires on first open, not on tab
// render.
const ActivityComposer = lazy(() =>
  import("./activity-composer.tsx").then((m) => ({ default: m.ActivityComposer })),
);

type Props = {
  readonly groupId: string;
  readonly trackId: string;
  readonly canCreate: boolean;
};

/**
 * The Activities tab on the Track home. Three concerns:
 *   - The row list (`<ActivityRow>` stack).
 *   - The "+ New activity" affordance gated on facilitator authority.
 *   - The composer dialog, opened either fresh (Create) or seeded with
 *     an existing activity's body (Edit).
 *
 * Per the design prototype, clicking a row opens the composer for a
 * facilitator. Non-facilitators land here only via the future Activity
 * Player — until that surface ships in M9/M10, a participant viewing
 * this tab sees row metadata as a discovery surface; clicking is a
 * no-op for them.
 */
export function ActivitiesTab({ groupId, trackId, canCreate }: Props) {
  const query = useTrackActivities(trackId, true);
  const items = query.data ?? [];
  const showSkeleton = query.isLoading;
  const showError = query.isError && !query.isLoading;

  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const create = useCreateActivity(groupId, trackId);

  const onCreate = async (payload: ActivityComposerPayload) => create.mutateAsync(payload);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-[var(--color-ink-2)]">
          {showSkeleton
            ? "Loading…"
            : showError
              ? "Couldn't load activities."
              : items.length === 0
                ? "Composed by facilitators; available to everyone enrolled."
                : `${items.length} ${items.length === 1 ? "activity" : "activities"} on this track.`}
        </p>
        {canCreate ? (
          <Button type="button" size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={12} strokeWidth={1.75} aria-hidden="true" />
            New activity
          </Button>
        ) : null}
      </div>

      {showError ? (
        // Without this branch, server errors collapse silently to the
        // empty state — the same anti-pattern PR #17 caught on library
        // search. The Try-again refetch lets the operator recover
        // without a page reload.
        <Callout tone="danger" title="Couldn't load activities">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {asUserMessage(
                query.error,
                "The Activities surface didn't return — check your connection and try again.",
              )}
            </span>
            <Button size="sm" variant="secondary" onClick={() => query.refetch()}>
              Try again
            </Button>
          </div>
        </Callout>
      ) : showSkeleton ? (
        <div className="space-y-2">
          <Skeleton className="h-[60px] w-full" />
          <Skeleton className="h-[60px] w-full" />
          <Skeleton className="h-[60px] w-full" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No activities yet"
          description={
            canCreate
              ? "Compose the first activity from one or more built-in Parts. The Composer remembers Part ids across edits — completed Part Progress survives reorders."
              : "Activities — the things participants actually do — appear here as facilitators compose them."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-rule)]">
          {items.map((a, i) => (
            <div
              key={a.id}
              className={i < items.length - 1 ? "border-[var(--color-rule)] border-b" : undefined}
            >
              {/*
               * TODO(m10): row click should route everyone (including
               * facilitators) to the activity player surface — Hearth
               * is a study group, the facilitator is also a learner.
               * Edit-mode is an authority-gated affordance ON the
               * player chrome, not a separate destination. Today the
               * player doesn't exist yet, so facilitators land in the
               * composer (edit) and participants get a no-op. When
               * M10 ships the player, both roles route to it; the
               * `canCreate` gate moves to an "Edit" button rendered
               * on the player surface for those with authority.
               */}
              <ActivityRow
                activity={a}
                onSelect={canCreate ? () => setEditId(a.id) : () => undefined}
              />
            </div>
          ))}
        </div>
      )}

      {createOpen ? (
        <Suspense fallback={null}>
          <ActivityComposer
            open
            onClose={() => setCreateOpen(false)}
            trackId={trackId}
            groupId={groupId}
            siblings={items}
            activity={null}
            onSubmit={onCreate}
          />
        </Suspense>
      ) : null}

      {editId !== null ? (
        <Suspense fallback={null}>
          <EditActivityDialog
            key={editId}
            groupId={groupId}
            trackId={trackId}
            activityId={editId}
            siblings={items}
            onClose={() => setEditId(null)}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

/**
 * Loads the full activity by id, then opens the same composer in edit
 * mode. Lives here rather than as a separate route to keep the
 * facilitator's authoring surface inside one URL.
 */
function EditActivityDialog({
  groupId,
  trackId,
  activityId,
  siblings,
  onClose,
}: {
  readonly groupId: string;
  readonly trackId: string;
  readonly activityId: string;
  readonly siblings: readonly ActivityListItem[];
  readonly onClose: () => void;
}) {
  const detail = useActivity(activityId, true);
  const update = useUpdateActivity(groupId, trackId, activityId);
  const remove = useDeleteActivity(groupId, trackId);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (detail.isError) {
    return (
      <Modal open onClose={onClose} title="Couldn't load this activity" tone="danger">
        <Callout tone="danger">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {asUserMessage(
                detail.error,
                "The activity didn't load — check your connection and try again.",
              )}
            </span>
            <Button size="sm" variant="secondary" onClick={() => detail.refetch()}>
              Try again
            </Button>
          </div>
        </Callout>
      </Modal>
    );
  }

  if (detail.isLoading || !detail.data) {
    // Mount the composer at the same moment the detail resolves so the
    // dialog never flickers an empty form against a stale activity.
    return null;
  }

  const onSubmit = async (payload: ActivityComposerPayload) => update.mutateAsync(payload);

  const onDelete = async () => {
    try {
      await remove.mutateAsync(activityId);
      toast.success("Activity deleted.");
      setConfirmOpen(false);
      onClose();
    } catch (err) {
      toast.error(asUserMessage(err, "Couldn't delete the activity."));
    }
  };

  return (
    <>
      <ActivityComposer
        open
        onClose={onClose}
        trackId={trackId}
        groupId={groupId}
        siblings={siblings}
        activity={detail.data}
        onSubmit={onSubmit}
        // The composer renders its own footer; the parent feeds an
        // optional Delete button into that footer through the slot
        // below so destructive actions stay co-located with Save.
        deleteSlot={
          <Button
            type="button"
            variant="secondary"
            onClick={() => setConfirmOpen(true)}
            disabled={remove.isPending}
          >
            <Trash2 size={12} strokeWidth={1.75} aria-hidden="true" />
            Delete
          </Button>
        }
      />
      <ConfirmActionDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={onDelete}
        title="Delete this activity?"
        description="This removes the activity for everyone on the track. If any other activity holds it as a prerequisite, the delete is blocked — drop those edges first. This action cannot be undone."
        confirmLabel="Delete activity"
        pending={remove.isPending}
        tone="destructive"
        confirmationPhrase="delete"
      />
    </>
  );
}
