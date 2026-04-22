import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="font-serif text-2xl">Hearth</h1>
      <p className="mt-2 text-muted-foreground">
        A collaborative learning product for small groups who study together over time.
      </p>
    </main>
  );
}
