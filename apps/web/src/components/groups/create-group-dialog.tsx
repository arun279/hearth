import { Button, Field, Input, Modal, Textarea } from "@hearth/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { asUserMessage } from "../../lib/problem.ts";

const NAME_MAX = 120;
const DESCRIPTION_MAX = 2000;

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give your group a name.")
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

export function CreateGroupDialog({ open, onClose, onCreate }: Props) {
  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", description: "" },
    mode: "onTouched",
  });

  // Reset the form on close so re-opening starts blank rather than retaining
  // half-typed input from a cancelled previous attempt.
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

  return (
    <Modal
      open={open}
      size="md"
      title="Create a Study Group"
      description="Pick a name your members will recognise. You'll be the first Group Admin; invitations and tracks come next."
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={form.formState.isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            form="create-group-form"
            disabled={submitDisabled}
          >
            {form.formState.isSubmitting ? "Creating…" : "Create Study Group"}
          </Button>
        </>
      }
    >
      <form id="create-group-form" className="space-y-4" noValidate onSubmit={onSubmit}>
        <Field label="Name" error={nameError}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-required
              autoFocus
              maxLength={NAME_MAX}
              placeholder="e.g., Tuesday Night Learners"
              invalid={nameError !== undefined}
              disabled={form.formState.isSubmitting}
              {...form.register("name")}
            />
          )}
        </Field>
        <Field
          label="Description"
          hint="Optional — a sentence or two for new members."
          error={descError}
        >
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              maxLength={DESCRIPTION_MAX}
              placeholder="A small group, patient pace. We learn together."
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
