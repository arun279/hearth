import { createFileRoute } from "@tanstack/react-router";
import { useDocumentTitle } from "../hooks/use-document-title.ts";

export const Route = createFileRoute("/me")({
  component: AccountComponent,
});

function AccountComponent() {
  useDocumentTitle(["Account"]);
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="font-serif text-2xl">Account</h1>
    </main>
  );
}
