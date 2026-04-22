import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/me")({
  component: AccountComponent,
});

function AccountComponent() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="font-serif text-2xl">Account</h1>
    </main>
  );
}
