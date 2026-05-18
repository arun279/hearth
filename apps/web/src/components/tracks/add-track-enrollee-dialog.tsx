import { Avatar, Button, Callout, EmptyState, Modal, Skeleton } from "@hearth/ui";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useGroupMembers } from "../../hooks/use-group-members.ts";
import { useEnrollInTrack } from "../../hooks/use-tracks.ts";
import { asUserMessage } from "../../lib/problem.ts";

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly groupId: string;
  readonly trackId: string;
  readonly trackName: string;
  readonly avatarOrigin: string;
  /** User ids of active track enrollees — excluded from the candidate set. */
  readonly enrolledUserIds: readonly string[];
  /** User ids of past enrollees — kept as candidates and tagged "previously enrolled". */
  readonly leftUserIds: readonly string[];
};

/**
 * Authority-only "Add to track" picker. Candidate set is current group
 * members minus current track enrollees; past enrollees stay in the list
 * tagged "previously enrolled" because the enroll use-case revives soft-
 * left rows by clearing `leftAt`/`leftBy`.
 *
 * Per-row Add: each click reuses `useEnrollInTrack`, which already
 * invalidates `track-people` on success — so the row leaves the candidate
 * list the moment the server confirms. The dialog stays open after each
 * add so a facilitator can onboard a cohort in one go.
 */
export function AddTrackEnrolleeDialog({
  open,
  onClose,
  groupId,
  trackId,
  trackName,
  avatarOrigin,
  enrolledUserIds,
  leftUserIds,
}: Props) {
  const members = useGroupMembers(groupId, open);
  const enroll = useEnrollInTrack(groupId, trackId);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  const enrolledIds = useMemo(() => new Set(enrolledUserIds), [enrolledUserIds]);
  const leftIds = useMemo(() => new Set(leftUserIds), [leftUserIds]);

  const candidates = useMemo(() => {
    const entries = members.data?.entries ?? [];
    return entries
      .filter((row) => !enrolledIds.has(row.membership.userId))
      .map((row) => ({
        userId: row.membership.userId,
        displayName: row.displayName,
        avatarUrl: row.membership.profile.avatarUrl,
        previouslyEnrolled: leftIds.has(row.membership.userId),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [members.data, enrolledIds, leftIds]);

  const handleClose = () => {
    if (pendingUserId !== null) return;
    onClose();
  };

  const handleAdd = async (userId: string, displayName: string) => {
    setPendingUserId(userId);
    try {
      await enroll.mutateAsync({ targetUserId: userId });
      toast.success(`${displayName} added to ${trackName}.`);
    } catch (err) {
      toast.error(asUserMessage(err, `Couldn't add ${displayName}.`));
    } finally {
      setPendingUserId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Add to ${trackName}`}
      description="Pick a group member to enrol on the track. They'll see the track in their list immediately."
      size="md"
      footer={
        <Button
          type="button"
          variant="secondary"
          onClick={handleClose}
          disabled={pendingUserId !== null}
        >
          Close
        </Button>
      }
    >
      {members.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-[44px] w-full" />
          <Skeleton className="h-[44px] w-full" />
          <Skeleton className="h-[44px] w-full" />
        </div>
      ) : members.isError ? (
        <Callout tone="danger" title="Couldn't load group members">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {asUserMessage(
                members.error,
                "The members list didn't load — check your connection and try again.",
              )}
            </span>
            <Button size="sm" variant="secondary" onClick={() => members.refetch()}>
              Try again
            </Button>
          </div>
        </Callout>
      ) : candidates.length === 0 ? (
        <EmptyState
          title="Everyone's on this track"
          description="All current group members are already enrolled. Invite more people to the group first if you need new participants."
        />
      ) : (
        <ul className="divide-y divide-[var(--color-rule)] rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)]">
          {candidates.map((c) => {
            const avatarSrc =
              c.avatarUrl !== null && c.avatarUrl.length > 0
                ? `${avatarOrigin}/${c.avatarUrl}`
                : null;
            const isThisRowPending = pendingUserId === c.userId;
            const anyRowPending = pendingUserId !== null;
            return (
              <li
                key={c.userId}
                className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3"
              >
                <div className="flex min-w-0 items-center gap-3 sm:flex-1">
                  <Avatar name={c.displayName} src={avatarSrc} size={32} />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-[var(--color-ink)]">
                      {c.displayName}
                    </span>
                    {c.previouslyEnrolled ? (
                      <span className="block text-[12px] text-[var(--color-ink-2)]">
                        previously enrolled
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 sm:ml-auto">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => handleAdd(c.userId, c.displayName)}
                    disabled={anyRowPending}
                    aria-label={`Add ${c.displayName}`}
                  >
                    {isThisRowPending ? "Adding…" : c.previouslyEnrolled ? "Re-add" : "Add"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
