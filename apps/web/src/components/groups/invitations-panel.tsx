import type { GroupInvitationStatus, StudyGroup } from "@hearth/domain";
import { Badge, Button } from "@hearth/ui";
import { Mail } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  type GroupInvitationView,
  useGroupInvitations,
  useRevokeGroupInvitation,
} from "../../hooks/use-group-invitations.ts";
import { formatRelative, formatShortDate } from "../../lib/format.ts";
import { asUserMessage } from "../../lib/problem.ts";
import { ConfirmActionDialog } from "../admin/confirm-action-dialog.tsx";

type Props = {
  readonly group: StudyGroup;
  readonly enabled: boolean;
  /**
   * Optional inline "Send another invitation" affordance. The page header
   * carries the canonical `+ Invite` primary; this panel offers a
   * lower-weight link so an admin scrolled down to the invitations list
   * doesn't have to scroll back up.
   */
  readonly onInvite?: () => void;
};

const STATUS_BADGE: Record<
  GroupInvitationStatus,
  { tone: "warn" | "accent" | "neutral" | "good"; label: string }
> = {
  pending: { tone: "accent", label: "pending" },
  pending_approval: { tone: "warn", label: "awaiting approval" },
  consumed: { tone: "neutral", label: "consumed" },
  revoked: { tone: "neutral", label: "revoked" },
  expired: { tone: "neutral", label: "expired" },
};

/**
 * Outstanding invitations list. Admins use this to track who they've
 * invited and to revoke an unused link if needed. Each row's status
 * comes from the server's projection so the SPA never combines nullable
 * timestamps client-side.
 */
export function InvitationsPanel({ group, enabled, onInvite }: Props) {
  const { data, isLoading } = useGroupInvitations(group.id, enabled);
  const revoke = useRevokeGroupInvitation(group.id);
  const [confirming, setConfirming] = useState<GroupInvitationView | null>(null);

  const entries = data ?? [];

  return (
    <section className="space-y-2" aria-labelledby="invitations-heading">
      <div className="flex flex-wrap items-center gap-3">
        <h2
          id="invitations-heading"
          className="font-medium text-[11px] text-[var(--color-ink-3)] uppercase tracking-wide"
        >
          Pending invitations ·{" "}
          {entries.filter((e) => e.status === "pending" || e.status === "pending_approval").length}
        </h2>
        {onInvite ? (
          <Button size="sm" variant="secondary" onClick={onInvite} className="ml-auto">
            Send another invitation
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] p-3 text-[12px] text-[var(--color-ink-3)]">
          Loading invitations…
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] p-3 text-[12px] text-[var(--color-ink-3)]">
          No invitations outstanding.
        </div>
      ) : (
        <ul
          aria-label="Outstanding invitations"
          className="divide-y divide-[var(--color-rule)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)]"
        >
          {entries.map((entry) => {
            const inv = entry.invitation;
            const badge = STATUS_BADGE[entry.status];
            const isLive = entry.status === "pending" || entry.status === "pending_approval";
            return (
              // The row stacks on phones and lays out as a single line on
              // tablet/desktop. At &lt; 480px the email + meta block sits
              // above the badge + revoke action, so a long invitee email
              // ("priya.long.name@example.com") doesn't get squeezed by
              // the right-aligned controls. `title` exposes the full
              // email for desktop hover.
              <li
                key={inv.id}
                className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Mail
                    size={14}
                    strokeWidth={1.5}
                    aria-hidden="true"
                    className="shrink-0 text-[var(--color-ink-3)]"
                  />
                  <div className="min-w-0 flex-1 text-[13px]">
                    <div
                      className="truncate text-[var(--color-ink)]"
                      title={inv.email ?? undefined}
                    >
                      {inv.email ?? "open invitation"}
                    </div>
                    <div
                      className="mt-0.5 truncate text-[11px] text-[var(--color-ink-3)]"
                      title={`Created ${formatShortDate(inv.createdAt)} · expires ${formatShortDate(inv.expiresAt)}`}
                    >
                      Created {formatShortDate(inv.createdAt)} · expires{" "}
                      {formatRelative(inv.expiresAt)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                  {isLive ? (
                    <Button size="sm" variant="secondary" onClick={() => setConfirming(entry)}>
                      Revoke
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmActionDialog
        tone="destructive"
        open={confirming !== null}
        title="Revoke this invitation?"
        description={
          confirming
            ? `${confirming.invitation.email ?? "The recipient"} will no longer be able to consume this invitation. Generate a new one if you change your mind.`
            : ""
        }
        confirmLabel="Revoke"
        pending={revoke.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          if (!confirming) return;
          try {
            await revoke.mutateAsync(confirming.invitation.id);
            toast.success("Invitation revoked.");
            setConfirming(null);
          } catch (err) {
            toast.error(asUserMessage(err, "Couldn't revoke."));
          }
        }}
      />
    </section>
  );
}
