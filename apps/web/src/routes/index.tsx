import { AppShell, EmptyState } from "@hearth/ui";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Sidebar } from "../components/sidebar.tsx";
import { SignInScreen } from "../components/sign-in-screen.tsx";
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

  // Signed-in. In M0 the group/track aggregates haven't landed, so we render
  // an empty state rather than a navigational dead-end.
  return (
    <AppShell sidebar={<Sidebar me={me} />} mobileTitle={me.instance.name}>
      <div className="mx-auto max-w-2xl px-5 py-10">
        <EmptyState
          title="No Study Groups yet"
          description={
            me.isOperator
              ? "As an Instance Operator you'll be able to create Study Groups here once the group aggregate lands."
              : "Your Instance Operator hasn't added you to a Study Group yet. Check back after they invite you."
          }
        />
      </div>
    </AppShell>
  );
}
