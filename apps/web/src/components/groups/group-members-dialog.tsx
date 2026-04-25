import type { GroupRole, StudyGroup, UserId } from "@hearth/domain";
import { Badge, Button, Modal } from "@hearth/ui";
import { useState } from "react";
import { toast } from "sonner";
import {
  type GroupMemberRow,
  useGroupMembers,
  useRemoveGroupMember,
  useSetGroupAdmin,
} from "../../hooks/use-group-members.ts";
import { useMeContext } from "../../hooks/use-me-context.ts";
import { asUserMessage } from "../../lib/problem.ts";
import { ConfirmActionDialog } from "../admin/confirm-action-dialog.tsx";
import { MemberRow } from "./member-row.tsx";

const PUBLIC_AVATAR_ORIGIN = (
  (import.meta as unknown as { env: Record<string, string | undefined> }).env[
    "VITE_R2_PUBLIC_ORIGIN"
  ] ?? ""
).replace(/\/$/, "");

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly group: StudyGroup;
};

/**
 * Admin-side member management. The list comes with per-row capabilities
 * computed by the server, so we just render the affordances the actor
 * has authority to use. Promote/demote and remove run through the
 * shared <ConfirmActionDialog> for muscle-memory consistency with
 * archive / unarchive.
 */
export function GroupMembersDialog({ open, onClose, group }: Props) {
  const me = useMeContext();
  const myUserId = me.data?.data.user?.id ?? null;
  const members = useGroupMembers(group.id, open);
  const setRole = useSetGroupAdmin(group.id);
  const remove = useRemoveGroupMember(group.id);

  const [confirming, setConfirming] = useState<
    | { kind: "promote"; row: GroupMemberRow }
    | { kind: "demote"; row: GroupMemberRow }
    | { kind: "remove"; row: GroupMemberRow }
    | null
  >(null);

  const close = () => {
    if (setRole.isPending || remove.isPending) return;
    onClose();
  };

  const entries = members.data?.entries ?? [];
  const adminCount = members.data?.adminCount ?? 0;

  return (
    <>
      <Modal
        open={open}
        size="lg"
        title={`${group.name} — members`}
        description="Active groups must keep at least one Group Admin. Demoting or removing the last admin is blocked."
        onClose={close}
        footer={
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-3 text-[12px] text-[var(--color-ink-2)]">
          <span className="text-[var(--color-ink-3)]">Status</span>
          <Badge tone={group.status === "archived" ? "warn" : "good"}>{group.status}</Badge>
          <span className="text-[var(--color-ink-3)]">Admins</span>
          <span>{adminCount}</span>
        </div>

        {members.isLoading ? (
          <div className="text-[12px] text-[var(--color-ink-3)]">Loading members…</div>
        ) : entries.length === 0 ? (
          <div className="text-[12px] text-[var(--color-ink-3)]">No active members.</div>
        ) : (
          <ul
            aria-label="Group members"
            className="divide-y divide-[var(--color-rule)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-rule)]"
          >
            {entries.map((row) => {
              const m = row.membership;
              const isMe = myUserId !== null && (m.userId as UserId) === myUserId;
              return (
                <MemberRow
                  key={m.userId}
                  membership={m}
                  isMe={isMe}
                  avatarOrigin={PUBLIC_AVATAR_ORIGIN}
                  avatarSize={28}
                  actions={
                    <>
                      <Badge tone={m.role === "admin" ? "accent" : "neutral"}>{m.role}</Badge>
                      {row.capabilities.canPromote ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setConfirming({ kind: "promote", row })}
                        >
                          Make admin
                        </Button>
                      ) : null}
                      {row.capabilities.canDemote ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setConfirming({ kind: "demote", row })}
                        >
                          Remove admin
                        </Button>
                      ) : null}
                      {row.capabilities.canRemove ? (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setConfirming({ kind: "remove", row })}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </>
                  }
                />
              );
            })}
          </ul>
        )}
      </Modal>

      <ConfirmActionDialog
        tone="primary"
        open={confirming?.kind === "promote"}
        title="Promote to Group Admin?"
        description={
          confirming?.kind === "promote"
            ? `${labelOf(confirming.row)} will gain authority to manage the group's members, invitations, and settings.`
            : ""
        }
        confirmLabel="Make admin"
        pending={setRole.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          if (confirming?.kind !== "promote") return;
          await runRoleChange(
            setRole,
            confirming.row.membership.userId,
            "admin",
            "Promoted to admin.",
          );
          setConfirming(null);
        }}
      />
      <ConfirmActionDialog
        tone="destructive"
        open={confirming?.kind === "demote"}
        title="Remove admin role?"
        description={
          confirming?.kind === "demote"
            ? `${labelOf(confirming.row)} will become a regular Group Member. They keep access; admin powers go away.`
            : ""
        }
        confirmLabel="Remove admin"
        pending={setRole.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          if (confirming?.kind !== "demote") return;
          await runRoleChange(
            setRole,
            confirming.row.membership.userId,
            "participant",
            "Admin role removed.",
          );
          setConfirming(null);
        }}
      />
      <ConfirmActionDialog
        tone="destructive"
        open={confirming?.kind === "remove"}
        title="Remove from group?"
        description={
          confirming?.kind === "remove"
            ? `${labelOf(confirming.row)} will lose access to ${group.name}. Their past activity records stay attributed unless they choose to anonymize.`
            : ""
        }
        confirmLabel="Remove member"
        pending={remove.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          if (confirming?.kind !== "remove") return;
          try {
            await remove.mutateAsync(confirming.row.membership.userId);
            toast.success("Member removed.");
            setConfirming(null);
          } catch (err) {
            toast.error(asUserMessage(err, "Couldn't remove member."));
          }
        }}
      />
    </>
  );
}

function labelOf(row: GroupMemberRow): string {
  return row.membership.profile.nickname ?? row.membership.displayNameSnapshot ?? "This member";
}

async function runRoleChange(
  setRole: ReturnType<typeof useSetGroupAdmin>,
  userId: UserId,
  role: GroupRole,
  successMsg: string,
) {
  try {
    await setRole.mutateAsync({ userId, role });
    toast.success(successMsg);
  } catch (err) {
    toast.error(asUserMessage(err, "Role change failed."));
  }
}
