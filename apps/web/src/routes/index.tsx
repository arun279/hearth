import type { GroupMembership } from "@hearth/domain";
import { AppShell, Button, EmptyState, Skeleton } from "@hearth/ui";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { CreateGroupDialog } from "../components/groups/create-group-dialog.tsx";
import { GroupCard } from "../components/groups/group-card.tsx";
import { Sidebar } from "../components/sidebar.tsx";
import { SignInScreen } from "../components/sign-in-screen.tsx";
import { useCreateGroup, useMyGroups } from "../hooks/use-groups.ts";
import { useMeContext } from "../hooks/use-me-context.ts";

const searchSchema = z.object({
  rejection: z.enum(["email_not_approved"]).optional(),
});

export const Route = createFileRoute("/")({
  validateSearch: searchSchema,
  component: HomeComponent,
});

function HomeComponent() {
  const search = Route.useSearch();
  const { data, isLoading, isError } = useMeContext();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--color-ink-3)]">
        Loading…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <div>
          <div className="font-serif text-[var(--color-ink)] text-xl">Hearth is unreachable</div>
          <p className="mt-1 text-[13px] text-[var(--color-ink-2)]">
            The API did not respond. Please retry in a moment.
          </p>
        </div>
      </div>
    );
  }

  const me = data.data;

  if (!me.user) {
    return <SignInScreen me={me} rejection={search.rejection ?? null} />;
  }

  return (
    <AppShell sidebar={<Sidebar me={me} />} mobileTitle={me.instance.name}>
      <SignedInHome me={me} />
    </AppShell>
  );
}

function SignedInHome({
  me,
}: {
  readonly me: NonNullable<ReturnType<typeof useMeContext>["data"]>["data"];
}) {
  const groups = useMyGroups(me.user !== null);
  const create = useCreateGroup();
  const [createOpen, setCreateOpen] = useState(false);

  const myMembershipById = new Map<string, GroupMembership>(
    me.memberships.map((m) => [m.groupId, m]),
  );

  const entries = groups.data ?? [];
  const empty = !groups.isLoading && entries.length === 0;

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 md:px-8">
      <header className="space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
          Your groups
        </div>
        <h1 className="font-serif text-[28px] leading-tight text-[var(--color-ink)]">
          {me.instance.name}
        </h1>
        <p className="text-[13px] text-[var(--color-ink-2)]">
          A small, trusted space for learning together. Pick a group to continue, or — if you're the
          operator — start a new one.
        </p>
      </header>

      <div className="mt-6 space-y-3">
        {groups.isLoading ? (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </>
        ) : empty ? (
          <EmptyState
            title="No Study Groups yet"
            description={
              me.isOperator
                ? "Create your first group below. You'll be its first Group Admin."
                : "Your Instance Operator hasn't added you to a Study Group yet. Check back after they invite you."
            }
          />
        ) : (
          <ul className="space-y-2" aria-label="Your Study Groups">
            {entries.map((group) => (
              <li key={group.id}>
                <GroupCard group={group} myRole={myMembershipById.get(group.id)?.role ?? null} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {me.isOperator ? (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" onClick={() => setCreateOpen(true)}>
            <Plus size={12} strokeWidth={2} aria-hidden="true" />
            Create Study Group
          </Button>
        </div>
      ) : null}

      <CreateGroupDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={async (input) => {
          await create.mutateAsync(input);
          toast.success("Study Group created.");
          setCreateOpen(false);
        }}
      />
    </div>
  );
}
