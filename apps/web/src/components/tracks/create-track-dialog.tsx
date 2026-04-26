import { Button, Field, Input, Modal, Textarea } from "@hearth/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { asUserMessage } from "../../lib/problem.ts";

// jscpd:ignore-start
const NAME_MAX = 120;
const DESCRIPTION_MAX = 2000;

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give your Learning Track a name.")
    .max(NAME_MAX, `Name must be ${NAME_MAX} characters or fewer.`),
  description: z
    .string()
    .trim()
    .max(DESCRIPTION_MAX, `Description must be ${DESCRIPTION_MAX} characters or fewer.`)
    .optional(),
});

type CreateForm = z.infer<typeof createSchema>;

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Throws on failure; the dialog maps the error onto the name field. */
  readonly onCreate: (input: { name: string; description?: string }) => Promise<void>;
};
// jscpd:ignore-end

/**
 * Group-Admin entry point for adding a Learning Track. The creator becomes
 * the first Track Facilitator in the same transaction (handled server-side
 * inside `createTrack`), so the resulting track always satisfies the
 * "active track ≥ 1 facilitator" invariant.
 */
export function CreateTrackDialog({ open, onClose, onCreate }: Props) {
  // Mirror-pair of `CreateGroupDialog` — same form + Modal + onCreate
  // contract, deliberately. The diverging surface is the copy and the
  // call-site wrapper that wires the mutation; the form plumbing is the
  // pattern. Flatten the structure once jscpd-ignored than abstract a
  // shared "create-name+description" component that would obscure which
  // domain entity each dialog speaks for.
  // jscpd:ignore-start
  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", description: "" },
    mode: "onTouched",
  });

  useEffect(() => {
    if (!open) form.reset({ name: "", description: "" });
  }, [open, form]);

  const close = () => {
    if (form.formState.isSubmitting) return;
    onClose();
  };

  const onSubmit = form.handleSubmit(async ({ name, description }) => {
    try {
      await onCreate({
        name,
        ...(description && description.length > 0 ? { description } : {}),
      });
    } catch (err) {
      form.setError("name", { type: "server", message: asUserMessage(err, "Couldn't create.") });
    }
  });

  const nameError = form.formState.errors.name?.message;
  const descError = form.formState.errors.description?.message;
  const nameValue = form.watch("name");
  const submitDisabled = form.formState.isSubmitting || nameValue.trim().length === 0;
  // jscpd:ignore-end

  return (
    <Modal
      open={open}
      size="md"
      title="Create a Learning Track"
      description="Tracks group activities, sessions, and library items around a single learning goal. You'll start as the only facilitator — invite others later."
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={form.formState.isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            form="create-track-form"
            disabled={submitDisabled}
          >
            {form.formState.isSubmitting ? "Creating…" : "Create Learning Track"}
          </Button>
        </>
      }
    >
      <form id="create-track-form" className="space-y-4" noValidate onSubmit={onSubmit}>
        <Field label="Name" error={nameError}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-required
              autoFocus
              maxLength={NAME_MAX}
              placeholder="e.g., Beginner Spanish"
              invalid={nameError !== undefined}
              disabled={form.formState.isSubmitting}
              {...form.register("name")}
            />
          )}
        </Field>
        <Field
          label="Description"
          hint="Optional — a sentence on what this track is about."
          error={descError}
        >
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              maxLength={DESCRIPTION_MAX}
              placeholder="e.g., A patient pace through the basics, week by week."
              invalid={descError !== undefined}
              disabled={form.formState.isSubmitting}
              {...form.register("description")}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}
