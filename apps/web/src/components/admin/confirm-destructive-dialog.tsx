import { Button, Modal } from "@hearth/ui";
import type { ReactNode } from "react";

type ConfirmDestructiveDialogProps = {
  readonly open: boolean;
  readonly title: string;
  readonly description?: ReactNode;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
  readonly pending?: boolean;
  readonly children?: ReactNode;
};

export function ConfirmDestructiveDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  pending,
  children,
}: ConfirmDestructiveDialogProps) {
  return (
    <Modal
      open={open}
      onClose={pending ? () => {} : onClose}
      title={title}
      description={description}
      size="sm"
      tone="danger"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={pending}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
