import { AppShell, Callout, panelIdFor, TabBar, tabIdFor } from "@hearth/ui";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import { ApprovedEmailsTab } from "../components/admin/approved-emails-tab.tsx";
import { OperatorsTab } from "../components/admin/operators-tab.tsx";
import { SettingsTab } from "../components/admin/settings-tab.tsx";
import { Sidebar } from "../components/sidebar.tsx";
import { useDocumentTitle } from "../hooks/use-document-title.ts";
import { useMeContext } from "../hooks/use-me-context.ts";
import { loadMeContext } from "../lib/me-context.ts";

const TAB_TITLES: Record<"settings" | "operators" | "emails", string> = {
  settings: "Instance settings",
  operators: "Operators",
  emails: "Approved emails",
};

const searchSchema = z.object({
  tab: z.enum(["settings", "operators", "emails"]).optional(),
});

const TAB_PREFIX = "instance-admin";

export const Route = createFileRoute("/admin/instance")({
  validateSearch: searchSchema,
  // The SPA checks isOperator client-side; the server also enforces per route.
  // A non-operator who guesses the URL hits the Operators/Emails API routes
  // and gets a 403 with the toast message we already map — the redirect here
  // is just a gentler UX.
  beforeLoad: async ({ context, location }) => {
    const me = await loadMeContext(context.queryClient);
    if (!me?.user) {
      throw redirect({ to: "/", search: {} });
    }
    if (!me.isOperator) {
      queueMicrotask(() => {
        toast.error("You need operator access to open that page.");
      });
      throw redirect({ to: "/", search: {} });
    }
    return { me, from: location.pathname };
  },
  component: InstanceAdminPage,
});

function InstanceAdminPage() {
  const { me } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const ctx = useMeContext();
  const instanceName = ctx.data?.data.instance.name ?? me.instance.name;

  const active = search.tab ?? "settings";

  useDocumentTitle([TAB_TITLES[active], "Admin"]);

  return (
    <AppShell sidebar={<Sidebar me={ctx.data?.data ?? me} />} mobileTitle={instanceName}>
      <div className="mx-auto max-w-3xl space-y-6 px-5 py-8 md:px-8">
        <header className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
            Admin
          </div>
          <h1 className="font-serif text-[28px] leading-tight text-[var(--color-ink)]">
            Instance settings
          </h1>
          <p className="text-[13px] text-[var(--color-ink-2)]">
            Rename the instance, manage who can sign in, and delegate operator authority.
          </p>
        </header>

        <Callout tone="warn" title="Keep the killswitch URL bookmarked">
          An Instance Operator can flip this Hearth instance to <code>read_only</code> or
          <code> disabled</code> by visiting the bearer-authed killswitch endpoint. Keep the URL and
          token bookmarked off-device so a runaway write can still be stopped.
        </Callout>

        <TabBar
          ariaLabel="Instance settings sections"
          idPrefix={TAB_PREFIX}
          value={active}
          items={[
            { value: "settings", label: "Settings" },
            { value: "operators", label: "Operators" },
            { value: "emails", label: "Approved emails" },
          ]}
          onChange={(next) => {
            void navigate({ search: { tab: next === "settings" ? undefined : next } });
          }}
        />

        <div
          role="tabpanel"
          id={panelIdFor(TAB_PREFIX)}
          aria-labelledby={tabIdFor(TAB_PREFIX, active)}
          className="pt-2"
        >
          {active === "settings" ? <SettingsTab /> : null}
          {active === "operators" ? <OperatorsTab currentUserId={me.user?.id ?? ""} /> : null}
          {active === "emails" ? <ApprovedEmailsTab /> : null}
        </div>
      </div>
    </AppShell>
  );
}
