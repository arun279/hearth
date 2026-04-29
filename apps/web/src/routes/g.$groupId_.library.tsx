import type { LibraryItemId } from "@hearth/domain";
import { Button, Callout, EmptyState, Skeleton } from "@hearth/ui";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { GroupPageShell } from "../components/groups/group-page-shell.tsx";
import { GroupSubpageBreadcrumb } from "../components/groups/group-subpage-breadcrumb.tsx";
import { LibraryItemCard } from "../components/library/library-item-card.tsx";
import { LibraryItemDetail } from "../components/library/library-item-detail.tsx";
import { UploadDialog } from "../components/library/upload-dialog.tsx";
import { useDocumentTitle } from "../hooks/use-document-title.ts";
import { useGroup } from "../hooks/use-groups.ts";
import { useLibraryList } from "../hooks/use-library.ts";
import { useMeContext } from "../hooks/use-me-context.ts";
import { loadMeContextOrNull } from "../lib/me-context.ts";

const searchSchema = z.object({
  /** When set, the detail modal opens scoped to this item. */
  item: z.string().min(1).max(64).optional(),
  /** When `?upload=open`, the upload dialog opens on mount. */
  upload: z.enum(["open"]).optional(),
});

export const Route = createFileRoute("/g/$groupId_/library")({
  validateSearch: searchSchema,
  beforeLoad: async ({ context }) => {
    const me = await loadMeContextOrNull(context.queryClient);
    if (!me?.user) {
      throw redirect({ to: "/", search: {} });
    }
  },
  component: LibraryPage,
});

function LibraryPage() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const me = useMeContext();
  const signedIn = me.data?.data.user !== null && me.data?.data.user !== undefined;
  const group = useGroup(params.groupId, signedIn);
  const list = useLibraryList(params.groupId, signedIn && group.data !== undefined);

  useDocumentTitle(["Library", group.data?.group.name]);

  const [uploadOpenLocal, setUploadOpenLocal] = useState(false);
  const uploadOpen = uploadOpenLocal || search.upload === "open";

  if (me.isLoading || !me.data?.data.user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--color-ink-3)]">
        Loading…
      </div>
    );
  }

  return (
    <GroupPageShell me={me.data.data} group={group}>
      {(detail) => {
        const { group: g } = detail;
        const archived = g.status === "archived";
        const canUpload = list.data?.caps.canUpload === true && !archived;
        const entries = list.data?.entries ?? [];

        const closeUpload = () => {
          setUploadOpenLocal(false);
          if (search.upload === "open") {
            void navigate({ to: ".", search: (s) => ({ ...s, upload: undefined }) });
          }
        };

        const openItem = (itemId: string) => {
          void navigate({ to: ".", search: (s) => ({ ...s, item: itemId }) });
        };

        const closeItem = () => {
          void navigate({ to: ".", search: (s) => ({ ...s, item: undefined }) });
        };

        return (
          <>
            <div className="mx-auto max-w-3xl px-5 py-8 md:px-8">
              <GroupSubpageBreadcrumb groupId={g.id} groupName={g.name} currentLabel="Library" />

              <header className="mt-3 flex flex-col items-start gap-2 md:flex-row md:items-center md:gap-3">
                <div className="min-w-0 flex-1">
                  <h1 className="font-serif text-[28px] text-[var(--color-ink)] leading-tight">
                    Library
                  </h1>
                  <p className="mt-1 text-[13px] text-[var(--color-ink-2)]">
                    Shared materials for {g.name}. Activities reference items here so a steward can
                    update one source and every track stays in sync.
                  </p>
                </div>
                {canUpload && entries.length > 0 ? (
                  <Button size="sm" variant="primary" onClick={() => setUploadOpenLocal(true)}>
                    <Plus size={12} strokeWidth={1.75} aria-hidden /> Upload
                  </Button>
                ) : null}
              </header>

              {archived ? (
                <Callout tone="warn" title="This group is archived" className="mt-4">
                  Existing items stay readable, but new uploads and revisions are paused. Unarchive
                  from group settings to resume.
                </Callout>
              ) : null}

              <section className="mt-6" aria-labelledby="library-heading">
                <h2 id="library-heading" className="sr-only">
                  Library items
                </h2>
                {list.isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                  </div>
                ) : entries.length === 0 ? (
                  <EmptyState
                    title="No library items yet"
                    description={
                      canUpload
                        ? "Upload a PDF, audio, or video here. Activities can pin specific revisions so updates don't break old work."
                        : "Once a steward uploads materials, you'll see them here."
                    }
                    action={
                      canUpload ? (
                        <Button onClick={() => setUploadOpenLocal(true)}>
                          <Plus size={12} aria-hidden /> Upload your first item
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <ul className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] divide-y divide-[var(--color-rule)]">
                    {entries.map((entry) => (
                      <li key={entry.item.id}>
                        <LibraryItemCard entry={entry} onSelect={openItem} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <UploadDialog open={uploadOpen} onClose={closeUpload} groupId={params.groupId} />

            {search.item ? (
              <LibraryItemDetail
                groupId={params.groupId}
                itemId={search.item as LibraryItemId}
                open
                onClose={closeItem}
                archived={archived}
              />
            ) : null}
          </>
        );
      }}
    </GroupPageShell>
  );
}
