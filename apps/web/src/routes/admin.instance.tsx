import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/instance")({
  component: InstanceAdmin,
});

function InstanceAdmin() {
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="font-serif text-2xl">Instance Operator</h1>
    </main>
  );
}
