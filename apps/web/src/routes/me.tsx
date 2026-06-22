import { PageContainer } from "@hearth/ui";
import { createFileRoute } from "@tanstack/react-router";
import { useDocumentTitle } from "../hooks/use-document-title.ts";

export const Route = createFileRoute("/me")({
  component: AccountComponent,
});

function AccountComponent() {
  useDocumentTitle(["Account"]);
  // TODO(m18): /me is a chrome-less stub — no shell, no back affordance, and
  // (because nothing here mounts useTheme) a fresh load never re-applies the
  // persisted dark theme. When M18 builds out account management, host this in
  // the themed AppShell (or at minimum mount useTheme + a back affordance).
  return (
    <PageContainer as="main" measure="prose">
      <h1 className="font-serif text-[1.75rem] text-[var(--color-ink)] leading-tight">Account</h1>
    </PageContainer>
  );
}
