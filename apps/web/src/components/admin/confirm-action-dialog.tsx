import { Button, Callout, Field, Input, Modal } from "@hearth/ui";
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
  /**
   * A failed-confirm message. The dialog stays open after a failed action
   * (it only closes on success), so a toast alone auto-dismisses before the
   * user re-reads it — this renders a durable in-dialog danger Callout and
   * leaves the confirm button live for a retry. Pass the mutation's
   * `asUserMessage(...)` text when its `isError` is set.
   *
   * Callers feed this straight from a React Query mutation's `isError`, which
   * stays latched until the next `mutate`/`reset`. The dialog scopes display
   * to the current open session (suppressed until the user confirms again
   * after reopening), so a failed action followed by close→reopen never shows
   * a stale Callout with no request in flight — and a mutation shared across
   * sibling dialogs (promote/demote) can't leak its error into the other.
   * Call sites therefore don't need to `reset()` the mutation on close.
   */
  readonly errorMessage?: string;
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
  errorMessage,
}: ConfirmActionDialogProps) {
  const [typed, setTyped] = useState("");
  const [confirmAttempted, setConfirmAttempted] = useState(false);
  const requiresPhrase = confirmationPhrase !== undefined && confirmationPhrase.length > 0;
  const phraseMatches =
    !requiresPhrase || typed.trim().toLowerCase() === confirmationPhrase?.toLowerCase();

  // Reset transient state every time the dialog opens so a half-typed phrase
  // or a latched error from a prior open never carries forward. The error is
  // shown only after a confirm in this session, so a stale mutation error
  // (close→reopen, or a sibling dialog sharing the mutation) stays hidden
  // until the user actually retries.
  useEffect(() => {
    if (open) {
      setTyped("");
      setConfirmAttempted(false);
    }
  }, [open, confirmationPhrase]);

  const showError = confirmAttempted && errorMessage !== undefined;

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
            onClick={() => {
              setConfirmAttempted(true);
              onConfirm();
            }}
            disabled={pending || !phraseMatches}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {showError ? (
        <Callout tone="danger" className="mb-3">
          {errorMessage}
        </Callout>
      ) : null}
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
