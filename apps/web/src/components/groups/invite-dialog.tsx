import type { StudyGroup } from "@hearth/domain";
import { Badge, Button, Callout, Field, Input, Modal } from "@hearth/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useCreateGroupInvitation } from "../../hooks/use-group-invitations.ts";
import { asUserMessage } from "../../lib/problem.ts";

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly group: StudyGroup;
};

const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Enter the invitee's email.")
    .max(254, "Email is too long.")
    .pipe(z.email("That's not a valid email address.")),
});

type InviteForm = z.infer<typeof inviteSchema>;

/**
 * Mints a single-use invitation token. Hearth doesn't send email in v1 —
 * the dialog returns the resulting URL for the inviter to copy and share
 * via whatever channel the group already uses (Slack, Signal, the same
 * group thread). On a private instance, the email needs to also be on
 * the Approved Email allowlist before sign-in will succeed; we surface
 * that as a callout the operator can act on.
 */
export function InviteDialog({ open, onClose, group }: Props) {
  const create = useCreateGroupInvitation(group.id);
  const [result, setResult] = useState<{
    url: string;
    emailApproved: boolean;
    email: string;
  } | null>(null);

  const form = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "" },
    mode: "onTouched",
  });

  const close = () => {
    if (form.formState.isSubmitting) return;
    setResult(null);
    form.reset({ email: "" });
    onClose();
  };

  const onSubmit = form.handleSubmit(async ({ email }) => {
    try {
      const res = await create.mutateAsync({ email });
      const url = `${window.location.origin}/invite/${res.invitation.token}`;
      setResult({ url, emailApproved: res.emailApproved, email });
      toast.success("Invitation created.");
    } catch (err) {
      form.setError("email", { type: "server", message: asUserMessage(err, "Invitation failed.") });
    }
  });

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      toast.success("Invitation link copied.");
    } catch {
      toast.error("Couldn't copy. Select and copy manually.");
    }
  };

  return (
    <Modal
      open={open}
      size="md"
      title="Send invitation"
      description={`Invite someone to ${group.name}. The link is single-use and expires in 14 days.`}
      onClose={close}
      footer={
        result ? (
          <>
            <Button variant="secondary" onClick={close}>
              Done
            </Button>
            <Button variant="primary" onClick={copy}>
              Copy link
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={form.formState.isSubmitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              form="invite-form"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? "Creating…" : "Create invitation"}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <Field label="Invitation link">
            {({ id }) => (
              <Input
                id={id}
                readOnly
                value={result.url}
                onFocus={(e) => e.currentTarget.select()}
              />
            )}
          </Field>
          <p className="text-[12px] text-[var(--color-ink-3)] leading-relaxed">
            Share this link with <strong>{result.email}</strong> via whatever channel works — Hearth
            doesn't send email in v1. They'll sign in with Google, then the link admits them.
          </p>
          {result.emailApproved ? null : (
            <Callout tone="warn" title="Approved Email needed">
              This is a private Hearth Instance. The invitation is ready, but{" "}
              <strong>{result.email}</strong> needs to be added as an Approved Email by an Instance
              Operator before sign-in will succeed.
            </Callout>
          )}
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-3)]">
            <Badge tone="accent">single-use</Badge>
            <span>Expires in 14 days · revoke from the invitations list</span>
          </div>
        </div>
      ) : (
        <form id="invite-form" noValidate onSubmit={onSubmit}>
          <Field label="Invitee email" error={form.formState.errors.email?.message}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                type="email"
                autoComplete="email"
                aria-describedby={describedBy}
                aria-required
                invalid={form.formState.errors.email !== undefined}
                disabled={form.formState.isSubmitting}
                placeholder="name@example.com"
                {...form.register("email")}
              />
            )}
          </Field>
        </form>
      )}
    </Modal>
  );
}
