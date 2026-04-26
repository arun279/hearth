import type { StudyGroup } from "@hearth/domain";
import { Button, Field, Modal } from "@hearth/ui";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useLeaveGroup } from "../../hooks/use-group-members.ts";
import { asUserMessage } from "../../lib/problem.ts";

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly group: StudyGroup;
  readonly defaultAttribution?: "preserve_name" | "anonymize";
};

/**
 * Two-step leave: pick attribution, then type the group's name to
 * confirm. Type-to-confirm exists because leaving the group is a
 * one-click loss-of-access action; a deliberate friction step matches
 * the prototype and Shneiderman's "permit easy reversal" rule (you
 * can't reverse it, so we slow you down here).
 */
export function LeaveGroupDialog({
  open,
  onClose,
  group,
  defaultAttribution = "preserve_name",
}: Props) {
  const leave = useLeaveGroup(group.id);
  const navigate = useNavigate();

  const [attribution, setAttribution] = useState<"preserve_name" | "anonymize">(defaultAttribution);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (open) {
      setAttribution(defaultAttribution);
      setConfirmText("");
    }
  }, [open, defaultAttribution]);

  const close = () => {
    if (leave.isPending) return;
    onClose();
  };

  // Case-insensitive comparison. The Field's label renders the group
  // name in uppercase via `text-transform`, which would otherwise mislead
  // a user typing "SPANISH CONVERSATION CLUB" into a case-sensitive
  // gate. Trim handles trailing-space slips. Both inputs are normalized
  // before comparison so internal whitespace remains significant.
  const canConfirm =
    confirmText.trim().toLocaleLowerCase() === group.name.trim().toLocaleLowerCase() &&
    !leave.isPending;

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Leave ${group.name}?`}
      tone="danger"
      description="Leaving ends your access. Past activity records remain attributed unless you anonymize."
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={leave.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!canConfirm}
            onClick={async () => {
              try {
                await leave.mutateAsync({ attribution });
                toast.success(`You left ${group.name}.`);
                onClose();
                await navigate({ to: "/", search: {} });
              } catch (err) {
                toast.error(asUserMessage(err, "Couldn't leave."));
              }
            }}
          >
            {leave.isPending ? "Leaving…" : "Leave group"}
          </Button>
        </>
      }
    >
      <Field
        label="Attribution"
        hint="Applies to artifacts you leave behind. Captured as a snapshot when you leave — later profile changes won't alter it."
      >
        {({ id }) => (
          <div id={id} className="space-y-1.5">
            <label className="flex items-start gap-2 text-[13px] text-[var(--color-ink-2)]">
              <input
                type="radio"
                name="attribution"
                value="preserve_name"
                checked={attribution === "preserve_name"}
                onChange={() => setAttribution("preserve_name")}
                className="mt-0.5"
              />
              <span>
                <span className="text-[var(--color-ink)]">Preserve my name</span> — keep my name
                attached to past participation (default).
              </span>
            </label>
            <label className="flex items-start gap-2 text-[13px] text-[var(--color-ink-2)]">
              <input
                type="radio"
                name="attribution"
                value="anonymize"
                checked={attribution === "anonymize"}
                onChange={() => setAttribution("anonymize")}
                className="mt-0.5"
              />
              <span>
                <span className="text-[var(--color-ink)]">Anonymize</span> — remove my name from
                past participation in this group.
              </span>
            </label>
          </div>
        )}
      </Field>
      <Field
        label={`Type "${group.name}" to confirm`}
        hint="A small step to keep accidental leaves rare."
      >
        {({ id }) => (
          <input
            id={id}
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-rule)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] text-[var(--color-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          />
        )}
      </Field>
    </Modal>
  );
}
