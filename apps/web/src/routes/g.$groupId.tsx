import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/g/$groupId")({
  component: GroupHome,
});

function GroupHome() {
  const { groupId } = Route.useParams();
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="font-serif text-2xl">Group {groupId}</h1>
    </main>
  );
}
