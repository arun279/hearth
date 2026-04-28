import type { LearningTrack } from "@hearth/domain";
import { toast } from "sonner";
import { useLeaveTrack } from "../../hooks/use-tracks.ts";
import { asUserMessage } from "../../lib/problem.ts";
import { ConfirmActionDialog } from "../admin/confirm-action-dialog.tsx";

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly groupId: string;
  readonly track: LearningTrack;
};

/**
 * Self-leave confirmation. Leaving a track is reversible — `ActivityRecord`
 * rows survive, the membership stays intact, and re-enrolling later
 * revives the row. Per the project's friction-asymmetry rule (terminal
 * actions earn type-to-confirm; reversible actions get plain
 * Cancel/Confirm), this dialog stops at a single deliberate click.
 *
 * No attribution radio: that field belongs to leave-group, where the
 * snapshot is captured to keep history attribution stable. Track-level
 * leaves don't take an attribution snapshot — a re-enrollment can pick
 * up where you left off.
 */
export function LeaveTrackDialog({ open, onClose, groupId, track }: Props) {
  const leave = useLeaveTrack(groupId, track.id);

  return (
    <ConfirmActionDialog
      open={open}
      onClose={() => {
        if (leave.isPending) return;
        onClose();
      }}
      title={`Leave ${track.name}?`}
      tone="destructive"
      confirmLabel={leave.isPending ? "Leaving…" : "Leave track"}
      pending={leave.isPending}
      onConfirm={async () => {
        try {
          await leave.mutateAsync();
          toast.success(`You left ${track.name}.`);
          onClose();
        } catch (err) {
          toast.error(asUserMessage(err, "Couldn't leave."));
        }
      }}
      description="Your prior activity records stay preserved on the track. You'll fall back to the group view of this track and can re-enroll later."
    />
  );
}
