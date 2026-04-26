import type { ApprovedEmail } from "@hearth/domain";
import { Button, EmptyState, Field, IconButton, Input, Skeleton, Textarea } from "@hearth/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  useAddApprovedEmail,
  useApprovedEmails,
  useRemoveApprovedEmail,
} from "../../hooks/use-instance-admin.ts";
import { formatShortDate } from "../../lib/format.ts";
import { asUserMessage } from "../../lib/problem.ts";
import { ConfirmActionDialog } from "./confirm-action-dialog.tsx";

const NOTE_MAX = 500;
// Mirrors the server-side `emailField` regex so client-side rejection matches
// what the API will accept; without this, `me@localhost` passes the bare
// `z.email()` here only to fail at the server with a round-trip wasted.
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const addEmailSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email like name@example.com."))
    .refine((v) => EMAIL_PATTERN.test(v), { message: "Email must include a domain." }),
  note: z.string().trim().max(NOTE_MAX).optional(),
});

type AddEmailForm = z.infer<typeof addEmailSchema>;

export function ApprovedEmailsTab() {
  const query = useApprovedEmails(true);
  const add = useAddApprovedEmail();
  const remove = useRemoveApprovedEmail();

  const bulkSummaryId = useId();
  const [bulk, setBulk] = useState("");
  const [bulkRows, setBulkRows] = useState<
    Array<{ email: string; status: "ok" | "err"; message: string }>
  >([]);

  const [targetRemove, setTargetRemove] = useState<ApprovedEmail | null>(null);

  const form = useForm<AddEmailForm>({
    resolver: zodResolver(addEmailSchema),
    defaultValues: { email: "", note: "" },
    mode: "onSubmit",
  });

  const onAdd = form.handleSubmit(async ({ email, note }) => {
    try {
      await add.mutateAsync({ email, note: note?.length ? note : undefined });
      toast.success("Email approved.");
      form.reset({ email: "", note: "" });
    } catch (err) {
      form.setError("email", { type: "server", message: asUserMessage(err, "Add failed.") });
    }
  });

  // Bulk paste is iterative-submission rather than a single form: each line
  // posts independently and reports per-line success/failure. RHF would be
  // overkill (no single field, no nested validation, no shared submission
  // lifecycle), so we keep it as a textarea-driven loop.
  async function submitBulk() {
    const lines = bulk
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    const results: typeof bulkRows = [];
    for (const raw of lines) {
      const value = raw.toLowerCase();
      if (!EMAIL_PATTERN.test(value)) {
        results.push({ email: raw, status: "err", message: "Invalid format." });
        continue;
      }
      try {
        await add.mutateAsync({ email: value });
        results.push({ email: value, status: "ok", message: "added" });
      } catch (err) {
        results.push({ email: value, status: "err", message: asUserMessage(err, "Failed.") });
      }
    }
    setBulkRows(results);
    const successes = results.filter((r) => r.status === "ok").length;
    if (successes > 0) setBulk("");
    if (successes === 0) {
      toast.error(`Couldn't add any of ${lines.length} emails. See per-row reasons below.`);
    } else if (successes === lines.length) {
      toast.success(`Added ${successes} emails.`);
    } else {
      toast.success(`Added ${successes} of ${lines.length}.`);
    }
  }

  const entries = query.data?.entries ?? [];
  const emailError = form.formState.errors.email?.message;

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] p-3.5">
        <div className="font-medium text-[11px] text-[var(--color-ink-3)] uppercase tracking-wide">
          Add an email
        </div>
        <form className="space-y-3" noValidate onSubmit={onAdd}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
            <Field label="Email" error={emailError}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="email"
                  inputMode="email"
                  autoCapitalize="off"
                  autoComplete="email"
                  placeholder="name@example.com"
                  invalid={emailError !== undefined}
                  disabled={form.formState.isSubmitting}
                  {...form.register("email")}
                />
              )}
            </Field>
            <Field label="Note (optional)">
              {({ id }) => (
                <Input
                  id={id}
                  placeholder="e.g. Maya from the book club"
                  disabled={form.formState.isSubmitting}
                  maxLength={NOTE_MAX}
                  {...form.register("note")}
                />
              )}
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="primary" disabled={form.formState.isSubmitting}>
                <Plus size={12} strokeWidth={2} aria-hidden="true" />
                {form.formState.isSubmitting ? "Adding…" : "Add email"}
              </Button>
            </div>
          </div>
        </form>

        <details className="rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-bg)] p-3">
          <summary
            id={bulkSummaryId}
            className="cursor-pointer font-medium text-[12px] text-[var(--color-ink-2)]"
          >
            Paste a list (one email per line)
          </summary>
          <form
            className="mt-3 space-y-3"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submitBulk();
            }}
          >
            <Textarea
              rows={5}
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              placeholder={"first@example.com\nsecond@example.com"}
              disabled={add.isPending}
              aria-labelledby={bulkSummaryId}
            />
            <div className="flex items-center justify-end">
              <Button
                type="submit"
                variant="secondary"
                disabled={add.isPending || bulk.trim() === ""}
              >
                {add.isPending ? "Adding…" : "Add all"}
              </Button>
            </div>
          </form>
          {bulkRows.length > 0 ? (
            <ul className="mt-3 space-y-1 text-[12px]">
              {bulkRows.map((r) => (
                <li
                  key={r.email + r.message}
                  className={
                    r.status === "ok" ? "text-[var(--color-good)]" : "text-[var(--color-danger)]"
                  }
                >
                  <span className="font-mono">{r.email}</span> — {r.message}
                </li>
              ))}
            </ul>
          ) : null}
        </details>
      </section>

      {query.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          title="No approved emails yet"
          description="Only the bootstrap operator can sign in until you approve more emails."
        />
      ) : (
        <ul
          className="divide-y divide-[var(--color-rule)] rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)]"
          aria-label="Approved emails"
        >
          {entries.map((row) => (
            <li key={row.email} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[13px] text-[var(--color-ink)]">
                  {row.email}
                </div>
                <div className="truncate text-[11px] text-[var(--color-ink-3)]">
                  added {formatShortDate(row.addedAt)}
                  {row.note ? ` · ${row.note}` : null}
                </div>
              </div>
              <IconButton
                label={`Remove ${row.email}`}
                onClick={() => setTargetRemove(row)}
                disabled={remove.isPending}
              >
                <X size={12} strokeWidth={1.75} aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <ConfirmActionDialog
        tone="destructive"
        open={targetRemove !== null}
        title="Remove approved email"
        description={
          <>
            Removing <span className="font-mono">{targetRemove?.email}</span> will sign out anyone
            currently signed in with that email. They can re-enter only if you re-approve them.
          </>
        }
        confirmLabel="Remove email"
        pending={remove.isPending}
        onClose={() => setTargetRemove(null)}
        onConfirm={async () => {
          if (!targetRemove) return;
          try {
            await remove.mutateAsync(targetRemove.email);
            toast.success(`${targetRemove.email} removed.`);
            setTargetRemove(null);
          } catch (err) {
            toast.error(asUserMessage(err, "Remove failed."));
          }
        }}
      />
    </div>
  );
}
