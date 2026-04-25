import type { InstanceOperator } from "@hearth/domain";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Skeleton,
} from "@hearth/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  useAssignOperator,
  useOperators,
  useRevokeOperator,
} from "../../hooks/use-instance-admin.ts";
import { ApiError, problemMessage } from "../../lib/problem.ts";
import { ConfirmDestructiveDialog } from "./confirm-destructive-dialog.tsx";

function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const grantSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email like name@example.com.")),
});

type GrantForm = z.infer<typeof grantSchema>;

type Props = {
  readonly currentUserId: string;
};

export function OperatorsTab({ currentUserId }: Props) {
  const query = useOperators(true);
  const assign = useAssignOperator();
  const revoke = useRevokeOperator();

  const [grantOpen, setGrantOpen] = useState(false);
  const [targetRevoke, setTargetRevoke] = useState<InstanceOperator | null>(null);

  const current = (query.data?.entries ?? []).filter((o) => o.revokedAt === null);
  const onlyOneOperator = current.length === 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-[var(--color-ink-2)]">
          Operators manage instance-level settings, Approved Emails, and each other.
        </p>
        <Button size="sm" variant="secondary" onClick={() => setGrantOpen(true)}>
          <Plus size={12} strokeWidth={2} aria-hidden="true" />
          Grant operator
        </Button>
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : current.length === 0 ? (
        <EmptyState
          title="No current operators"
          description="Grant an operator role to someone who has already signed in."
        />
      ) : (
        <ul
          className="divide-y divide-[var(--color-rule)] rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)]"
          aria-label="Current instance operators"
        >
          {current.map((op) => {
            const isSelf = op.userId === currentUserId;
            const revokeDisabled = isSelf || onlyOneOperator;
            const reason = isSelf
              ? "You can't revoke your own operator role."
              : onlyOneOperator
                ? "Grant another operator before revoking this one."
                : "Revoke operator";
            return (
              <li key={op.userId} className="flex items-center gap-3 px-3 py-2.5">
                <Avatar name={op.userId} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-[var(--color-ink)]">{op.userId}</div>
                  <div className="truncate text-[11px] text-[var(--color-ink-3)]">
                    granted {formatDate(op.grantedAt)}
                  </div>
                </div>
                {isSelf ? <Badge tone="accent">you</Badge> : null}
                <IconButton
                  label={reason}
                  title={reason}
                  onClick={() => setTargetRevoke(op)}
                  disabled={revokeDisabled || revoke.isPending}
                >
                  <X size={12} strokeWidth={1.75} aria-hidden="true" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}

      <GrantOperatorDialog
        open={grantOpen}
        onClose={() => setGrantOpen(false)}
        onGrant={async (email) => {
          await assign.mutateAsync({ email });
          toast.success("Operator granted.");
          setGrantOpen(false);
        }}
      />

      <ConfirmDestructiveDialog
        open={targetRevoke !== null}
        title="Revoke operator role"
        description="They will stop being able to change instance settings or manage Approved Emails."
        confirmLabel="Revoke"
        pending={revoke.isPending}
        onClose={() => setTargetRevoke(null)}
        onConfirm={async () => {
          if (!targetRevoke) return;
          try {
            await revoke.mutateAsync(targetRevoke.userId);
            toast.success("Operator revoked.");
            setTargetRevoke(null);
          } catch (err) {
            const message =
              err instanceof ApiError
                ? problemMessage(err.problem)
                : err instanceof Error
                  ? err.message
                  : "Revoke failed.";
            toast.error(message);
          }
        }}
      />
    </div>
  );
}

type GrantDialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Throws on failure; the dialog maps the error onto the email field. */
  readonly onGrant: (email: string) => Promise<void>;
};

function GrantOperatorDialog({ open, onClose, onGrant }: GrantDialogProps) {
  const form = useForm<GrantForm>({
    resolver: zodResolver(grantSchema),
    defaultValues: { email: "" },
    mode: "onSubmit",
  });

  const close = () => {
    if (form.formState.isSubmitting) return;
    form.reset({ email: "" });
    onClose();
  };

  const onSubmit = form.handleSubmit(async ({ email }) => {
    try {
      await onGrant(email);
      form.reset({ email: "" });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? problemMessage(err.problem)
          : err instanceof Error
            ? err.message
            : "Grant failed.";
      form.setError("email", { type: "server", message });
    }
  });

  const errorMessage = form.formState.errors.email?.message;

  return (
    <Modal
      open={open}
      size="sm"
      title="Grant operator role"
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={form.formState.isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            form="grant-operator-form"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? "Granting…" : "Grant operator"}
          </Button>
        </>
      }
    >
      <form id="grant-operator-form" className="space-y-4" noValidate onSubmit={onSubmit}>
        <p className="text-[12px] text-[var(--color-ink-2)]">
          The person must already have signed in. Add their email to Approved Emails first if they
          haven't.
        </p>
        <Field label="Email" error={errorMessage}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              autoFocus
              type="email"
              inputMode="email"
              autoCapitalize="off"
              autoComplete="email"
              invalid={errorMessage !== undefined}
              disabled={form.formState.isSubmitting}
              {...form.register("email")}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}
