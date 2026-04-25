import { Button, Modal } from "@hearth/ui";
import type { ReactNode } from "react";

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
}: ConfirmActionDialogProps) {
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
            disabled={pending}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
