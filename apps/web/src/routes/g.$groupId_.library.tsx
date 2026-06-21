import type { LibraryItemId } from "@hearth/domain";
import { Button, Callout, cn, EmptyState, Input, PageContainer, Skeleton } from "@hearth/ui";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Plus, Search, X } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { GroupPageShell } from "../components/groups/group-page-shell.tsx";
import { GroupSubpageBreadcrumb } from "../components/groups/group-subpage-breadcrumb.tsx";
import { LibraryItemCard } from "../components/library/library-item-card.tsx";
import { LibraryItemDetail } from "../components/library/library-item-detail.tsx";
import { UploadDialog } from "../components/library/upload-dialog.tsx";
import { useDebouncedValue } from "../hooks/use-debounced-value.ts";
import { useDocumentTitle } from "../hooks/use-document-title.ts";
import { useGroup } from "../hooks/use-groups.ts";
import { type LibraryListEntry, useLibraryList, useLibrarySearch } from "../hooks/use-library.ts";
import { useMeContext } from "../hooks/use-me-context.ts";
import { loadMeContextOrNull } from "../lib/me-context.ts";

const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_MIN_LENGTH = 2;

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

  const [searchInput, setSearchInput] = useState("");
  const trimmedInput = searchInput.trim();
  const debouncedQuery = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS).trim();
  const isSearching = debouncedQuery.length >= SEARCH_MIN_LENGTH;
  const isSubMinLength = trimmedInput.length > 0 && trimmedInput.length < SEARCH_MIN_LENGTH;
  const searchResults = useLibrarySearch(
    params.groupId,
    debouncedQuery,
    signedIn && group.data !== undefined && isSearching,
  );

  if (me.isLoading || !me.data?.data.user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--color-ink-2)]">
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
        const listEntries = list.data?.entries ?? [];
        const searchEntries: readonly LibraryListEntry[] =
          searchResults.data?.pages.flatMap((page) => page.entries) ?? [];
        const entries = isSearching ? searchEntries : listEntries;
        const showSearchBox = listEntries.length > 0 || trimmedInput.length > 0;
        const searchLoading = isSearching && searchResults.isLoading;
        const searchError = isSearching && searchResults.isError;
        const canLoadMore = isSearching && searchResults.hasNextPage === true;
        const loadingMore = searchResults.isFetchingNextPage;

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
            <PageContainer>
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
                {canUpload && listEntries.length > 0 ? (
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

              {showSearchBox ? (
                <div className="mt-5">
                  <label htmlFor="library-search-input" className="sr-only">
                    Search library
                  </label>
                  <div className="relative">
                    <Search
                      size={14}
                      strokeWidth={1.75}
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2",
                        "text-[var(--color-ink-2)]",
                      )}
                    />
                    <Input
                      id="library-search-input"
                      type="search"
                      placeholder="Search by title, description, or tag"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      className="pr-10 pl-8"
                      aria-controls="library-results"
                      aria-describedby={isSubMinLength ? "library-search-hint" : undefined}
                    />
                    {searchInput.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setSearchInput("")}
                        className={cn(
                          "absolute top-1/2 right-0 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-r-[var(--radius-md)]",
                          "text-[var(--color-ink-2)] hover:text-[var(--color-ink)]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
                        )}
                        aria-label="Clear search"
                      >
                        <X size={12} strokeWidth={1.75} aria-hidden />
                      </button>
                    ) : null}
                  </div>
                  {isSubMinLength ? (
                    <p
                      id="library-search-hint"
                      className="mt-1.5 text-[12px] text-[var(--color-ink-2)]"
                    >
                      Keep typing — search starts at {SEARCH_MIN_LENGTH} characters.
                    </p>
                  ) : null}
                  <div role="status" aria-live="polite" className="sr-only">
                    {searchError
                      ? "Search failed. Try again."
                      : searchLoading
                        ? "Searching…"
                        : isSearching
                          ? `${searchEntries.length} ${searchEntries.length === 1 ? "match" : "matches"}${canLoadMore ? ", more available" : ""}`
                          : ""}
                  </div>
                </div>
              ) : null}

              <section className="mt-6" aria-labelledby="library-heading">
                <h2 id="library-heading" className="sr-only">
                  Library items
                </h2>
                {searchError ? (
                  <Callout tone="danger" title="Search failed" className="mb-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <span>
                        Couldn't reach the library search. Check your connection and try again.
                      </span>
                      <Button size="sm" variant="secondary" onClick={() => searchResults.refetch()}>
                        Try again
                      </Button>
                    </div>
                  </Callout>
                ) : null}
                <div id="library-results">
                  {(isSearching ? searchLoading : list.isLoading) ? (
                    <div className="space-y-2">
                      <Skeleton className="h-14 w-full" />
                      <Skeleton className="h-14 w-full" />
                      <Skeleton className="h-14 w-full" />
                    </div>
                  ) : entries.length === 0 ? (
                    isSearching ? (
                      searchError ? null : (
                        <EmptyState
                          title="No matching items"
                          description={`Nothing in the library matches "${debouncedQuery}". Try a different keyword or tag.`}
                          action={
                            <Button variant="secondary" onClick={() => setSearchInput("")}>
                              Show all items
                            </Button>
                          }
                        />
                      )
                    ) : (
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
                    )
                  ) : (
                    <>
                      <ul className="divide-y divide-[var(--color-rule)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)]">
                        {entries.map((entry) => (
                          <li key={entry.item.id}>
                            <LibraryItemCard entry={entry} onSelect={openItem} />
                          </li>
                        ))}
                      </ul>
                      {canLoadMore ? (
                        <div className="mt-4 flex justify-center">
                          <Button
                            variant="secondary"
                            onClick={() => searchResults.fetchNextPage()}
                            disabled={loadingMore}
                          >
                            {loadingMore ? "Loading…" : "Load more"}
                          </Button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </section>
            </PageContainer>

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
