import type { StudyGroup } from "@hearth/domain";
import { Button, Field, Input, Modal, Textarea } from "@hearth/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  type GroupCaps,
  useArchiveGroup,
  useUnarchiveGroup,
  useUpdateGroupMetadata,
} from "../../hooks/use-groups.ts";
import { asUserMessage } from "../../lib/problem.ts";
import { ConfirmActionDialog } from "../admin/confirm-action-dialog.tsx";

const NAME_MAX = 120;
const DESCRIPTION_MAX = 2000;

const settingsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(NAME_MAX, `Name must be ${NAME_MAX} characters or fewer.`),
  description: z
    .string()
    .trim()
    .max(DESCRIPTION_MAX, `Description must be ${DESCRIPTION_MAX} characters or fewer.`),
});

type SettingsForm = z.infer<typeof settingsSchema>;

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly group: StudyGroup;
  readonly caps: GroupCaps;
};

export function GroupSettingsDialog({ open, onClose, group, caps }: Props) {
  const update = useUpdateGroupMetadata(group.id);
  const archive = useArchiveGroup(group.id);
  const unarchive = useUnarchiveGroup(group.id);

  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [confirmingUnarchive, setConfirmingUnarchive] = useState(false);

  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: { name: group.name, description: group.description ?? "" },
    mode: "onTouched",
  });

  // Re-hydrate the form whenever the group prop changes (e.g., after a
  // metadata update from another tab) or the dialog opens.
  useEffect(() => {
    if (open) {
      form.reset({ name: group.name, description: group.description ?? "" });
    }
  }, [open, group.name, group.description, form]);

  const close = () => {
    if (form.formState.isSubmitting || archive.isPending || unarchive.isPending) return;
    onClose();
  };

  const onSubmit = form.handleSubmit(async ({ name, description }) => {
    try {
      const trimmed = description.trim();
      await update.mutateAsync({
        ...(name !== group.name ? { name } : {}),
        ...(trimmed !== (group.description ?? "")
          ? { description: trimmed.length > 0 ? trimmed : null }
          : {}),
      });
      toast.success("Group updated.");
      onClose();
    } catch (err) {
      form.setError("name", { type: "server", message: asUserMessage(err, "Update failed.") });
    }
  });

  const nameError = form.formState.errors.name?.message;
  const descError = form.formState.errors.description?.message;
  const nameValue = form.watch("name");
  const submitDisabled =
    !form.formState.isDirty || form.formState.isSubmitting || nameValue.trim().length === 0;
  const archived = group.status === "archived";

  return (
    <>
      <Modal
        open={open}
        size="md"
        title="Group settings"
        description={
          archived
            ? "This group is archived — name and description are read-only. Unarchive from the panel below to resume edits."
            : "Edit the name your members see. Archiving freezes new work but keeps history readable."
        }
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={form.formState.isSubmitting}>
              Close
            </Button>
            {caps.canUpdateMetadata ? (
              <Button
                type="submit"
                variant="primary"
                form="group-settings-form"
                disabled={submitDisabled}
              >
                {form.formState.isSubmitting ? "Saving…" : "Save changes"}
              </Button>
            ) : null}
          </>
        }
      >
        <form id="group-settings-form" className="space-y-4" noValidate onSubmit={onSubmit}>
          <Field label="Name" error={nameError}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-required
                maxLength={NAME_MAX}
                invalid={nameError !== undefined}
                disabled={!caps.canUpdateMetadata || form.formState.isSubmitting}
                {...form.register("name")}
              />
            )}
          </Field>
          <Field label="Description" error={descError}>
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                rows={3}
                maxLength={DESCRIPTION_MAX}
                invalid={descError !== undefined}
                disabled={!caps.canUpdateMetadata || form.formState.isSubmitting}
                {...form.register("description")}
              />
            )}
          </Field>
        </form>

        {caps.canArchive || caps.canUnarchive ? (
          <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-soft)] p-3">
            <div className="font-medium text-[12px] text-[var(--color-ink)] uppercase tracking-wide">
              Danger zone
            </div>
            {archived ? (
              <>
                <p className="mt-1 text-[12px] text-[var(--color-ink-2)]">
                  This group is archived. Unarchiving lets members resume work; history is preserved
                  either way.
                </p>
                <Button
                  className="mt-2"
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirmingUnarchive(true)}
                  disabled={!caps.canUnarchive || unarchive.isPending}
                >
                  Unarchive group
                </Button>
              </>
            ) : (
              <>
                <p className="mt-1 text-[12px] text-[var(--color-ink-2)]">
                  Archiving freezes new tracks, activities, and contributions. Members can still
                  read everything that already exists.
                </p>
                <Button
                  className="mt-2"
                  variant="danger"
                  size="sm"
                  onClick={() => setConfirmingArchive(true)}
                  disabled={!caps.canArchive || archive.isPending}
                >
                  Archive group
                </Button>
              </>
            )}
          </div>
        ) : null}
      </Modal>

      <ConfirmActionDialog
        tone="destructive"
        open={confirmingArchive}
        title="Archive this group?"
        description="New activities, tracks, and contributions will be paused. History stays readable. You can unarchive later from this same panel."
        confirmLabel="Archive group"
        pending={archive.isPending}
        onClose={() => setConfirmingArchive(false)}
        onConfirm={async () => {
          try {
            await archive.mutateAsync();
            toast.success("Group archived.");
            setConfirmingArchive(false);
            onClose();
          } catch (err) {
            toast.error(asUserMessage(err, "Archive failed."));
          }
        }}
      />
      <ConfirmActionDialog
        tone="primary"
        open={confirmingUnarchive}
        title="Unarchive this group?"
        description="Members will be able to resume creating tracks, activities, and contributions."
        confirmLabel="Unarchive group"
        pending={unarchive.isPending}
        onClose={() => setConfirmingUnarchive(false)}
        onConfirm={async () => {
          try {
            await unarchive.mutateAsync();
            toast.success("Group unarchived.");
            setConfirmingUnarchive(false);
            onClose();
          } catch (err) {
            toast.error(asUserMessage(err, "Unarchive failed."));
          }
        }}
      />
    </>
  );
}
