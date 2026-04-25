import { Button, Field, Input, Skeleton } from "@hearth/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useInstanceSettings, useRenameInstance } from "../../hooks/use-instance-admin.ts";
import { ApiError, problemMessage } from "../../lib/problem.ts";

const NAME_MIN = 1;
const NAME_MAX = 80;

const renameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(NAME_MIN, "Name is required.")
    .max(NAME_MAX, `Name must be ${NAME_MAX} characters or fewer.`),
});

type RenameForm = z.infer<typeof renameSchema>;

export function SettingsTab() {
  const query = useInstanceSettings(true);
  const rename = useRenameInstance();

  const form = useForm<RenameForm>({
    resolver: zodResolver(renameSchema),
    defaultValues: { name: "" },
    mode: "onSubmit",
  });

  // Hydrate the form once the singleton row arrives.
  useEffect(() => {
    if (query.data) form.reset({ name: query.data.name });
  }, [query.data, form]);

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <p className="text-[13px] text-[var(--color-danger)]">
        Couldn't load instance settings. Reload to retry.
      </p>
    );
  }

  const onSubmit = form.handleSubmit(async ({ name }) => {
    try {
      await rename.mutateAsync(name);
      toast.success("Instance renamed.");
      form.reset({ name });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? problemMessage(err.problem)
          : err instanceof Error
            ? err.message
            : "Rename failed.";
      form.setError("name", { type: "server", message });
      toast.error(message);
    }
  });

  const errorMessage = form.formState.errors.name?.message;

  return (
    <form className="space-y-4" onSubmit={onSubmit} noValidate>
      <Field
        label="Instance name"
        hint="Shown in the sidebar and on the sign-in screen."
        error={errorMessage}
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            aria-required
            maxLength={NAME_MAX}
            invalid={errorMessage !== undefined}
            disabled={form.formState.isSubmitting}
            {...form.register("name")}
          />
        )}
      </Field>
      <div className="flex items-center justify-end gap-2">
        <Button
          type="submit"
          variant="primary"
          disabled={!form.formState.isDirty || form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
