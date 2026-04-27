import { Button, Field, Input, Modal } from "@hearth/ui";
import { type ReactNode, useEffect, useState } from "react";

type ConfirmActionTone = "destructive" | "primary";

type ConfirmActionDialogProps = {
  readonly open: boolean;
  readonly title: string;
  readonly description?: ReactNode;
  readonly confirmLabel: string;
  /**
   * "destructive" — red framing + danger button (archive, remove, revoke).
   * "primary" — neutral framing + filled-blue button for reversible-positive
   * actions like unarchive.
   */
  readonly tone: ConfirmActionTone;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
  readonly pending?: boolean;
  readonly children?: ReactNode;
  /**
   * Type-to-confirm for terminal / irreversible actions. When set, the
   * confirm button is disabled until the user types this phrase
   * (compared case-insensitively after trim) — adds the friction
   * Cloudscape and PatternFly recommend for actions that can't be
   * undone. Reversible actions (group archive, role demote) should
   * leave this unset; the basic Cancel/Confirm is enough friction.
   */
  readonly confirmationPhrase?: string;
};

export function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel,
  tone,
  onConfirm,
  onClose,
  pending,
  children,
  confirmationPhrase,
}: ConfirmActionDialogProps) {
  const [typed, setTyped] = useState("");
  const requiresPhrase = confirmationPhrase !== undefined && confirmationPhrase.length > 0;
  const phraseMatches =
    !requiresPhrase || typed.trim().toLowerCase() === confirmationPhrase?.toLowerCase();

  // Reset the field every time the dialog opens or the phrase changes so
  // a half-typed value from a prior cancel never carries forward.
  useEffect(() => {
    if (open) setTyped("");
  }, [open, confirmationPhrase]);

  return (
    <Modal
      open={open}
      onClose={pending ? () => {} : onClose}
      title={title}
      description={description}
      size="sm"
      tone={tone === "destructive" ? "danger" : "neutral"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={tone === "destructive" ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={pending || !phraseMatches}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {requiresPhrase ? (
        <Field
          label={
            <>
              Type <strong>{confirmationPhrase}</strong> to confirm
            </>
          }
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={pending}
            />
          )}
        </Field>
      ) : null}
    </Modal>
  );
}
