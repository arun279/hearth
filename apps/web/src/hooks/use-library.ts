import type {
  LibraryDisplayKind,
  LibraryItem,
  LibraryItemId,
  LibraryRevision,
  LibraryStewardship,
} from "@hearth/domain";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client.ts";
import { assertOk } from "../lib/problem.ts";

export type LibraryListEntry = {
  readonly item: LibraryItem;
  readonly currentRevision: LibraryRevision | null;
  readonly stewardCount: number;
  readonly usedInCount: number;
  readonly displayKind: LibraryDisplayKind;
};

type LibraryListResult = {
  readonly entries: readonly LibraryListEntry[];
  readonly caps: { readonly canUpload: boolean };
};

export type LibraryItemDetailPayload = {
  readonly detail: {
    readonly item: LibraryItem;
    readonly revisions: readonly LibraryRevision[];
    readonly stewards: readonly LibraryStewardship[];
    readonly usedInCount: number;
  };
  readonly caps: {
    readonly canAddRevision: boolean;
    readonly canRetire: boolean;
    readonly canUpdateMetadata: boolean;
    readonly canManageStewards: boolean;
  };
  readonly displayKind: LibraryDisplayKind;
};

type RequestUploadResult = {
  readonly uploadId: string;
  readonly libraryItemId: string;
  readonly revisionId: string;
  readonly key: string;
  readonly upload: {
    readonly url: string;
    readonly requiredHeaders: Readonly<Record<string, string>>;
  };
  /** Serialized through JSON. */
  readonly expiresAt: string;
  readonly byteQuotaRemaining: number;
};

const libraryListKey = (groupId: string) => ["library", "list", groupId] as const;
const libraryItemKey = (itemId: string) => ["library", "item", itemId] as const;

function invalidateLibrary(qc: QueryClient, groupId: string, itemId?: string) {
  qc.invalidateQueries({ queryKey: libraryListKey(groupId) });
  qc.invalidateQueries({ queryKey: ["groups", "detail", groupId] });
  if (itemId) qc.invalidateQueries({ queryKey: libraryItemKey(itemId) });
}

export function useLibraryList(groupId: string, enabled: boolean) {
  return useQuery({
    queryKey: libraryListKey(groupId),
    enabled,
    queryFn: async (): Promise<LibraryListResult> => {
      const res = await api.g[":groupId"].library.$get({ param: { groupId } });
      await assertOk(res);
      return (await res.json()) as LibraryListResult;
    },
  });
}

export function useLibraryItem(itemId: string, enabled: boolean) {
  return useQuery({
    queryKey: libraryItemKey(itemId),
    enabled,
    queryFn: async (): Promise<LibraryItemDetailPayload> => {
      const res = await api.library[":itemId"].$get({ param: { itemId } });
      await assertOk(res);
      return (await res.json()) as LibraryItemDetailPayload;
    },
  });
}

/**
 * Library upload mutation. Mirrors the avatar pattern in
 * `use-avatar-upload.ts`:
 *   1. POST /g/:groupId/library/upload-request → presigned PUT.
 *   2. PUT directly to R2 with `credentials: "omit"` so our session
 *      cookie does not leak cross-origin to R2.
 *   3. POST /library/finalize { uploadId, groupId, title, description, tags }.
 *
 * On success the SPA refetches the list / item detail. The mutation is
 * one closure so callers don't have to thread three loading states.
 */
export function useUploadLibraryItem(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly file: File;
      readonly title: string;
      readonly description: string | null;
      readonly tags: readonly string[];
      /** When set, finalize appends a revision to the existing item. */
      readonly libraryItemId?: string;
    }) => {
      const reqRes = await api.g[":groupId"].library["upload-request"].$post({
        param: { groupId },
        json: {
          mimeType: input.file.type,
          sizeBytes: input.file.size,
          ...(input.file.name ? { originalFilename: input.file.name } : {}),
          ...(input.libraryItemId !== undefined ? { libraryItemId: input.libraryItemId } : {}),
        },
      });
      await assertOk(reqRes);
      const requested = (await reqRes.json()) as RequestUploadResult;

      const putRes = await fetch(requested.upload.url, {
        method: "PUT",
        headers: requested.upload.requiredHeaders,
        body: input.file,
        credentials: "omit",
      });
      if (!putRes.ok) {
        throw new Error(`Library upload failed (R2 ${putRes.status}). Try again.`);
      }

      const finRes = await api.library.finalize.$post({
        json: {
          uploadId: requested.uploadId,
          groupId,
          title: input.title,
          description: input.description,
          tags: [...input.tags],
        },
      });
      await assertOk(finRes);
      return (await finRes.json()) as LibraryItemDetailPayload["detail"];
    },
    onSuccess: (detail) => invalidateLibrary(qc, groupId, detail.item.id),
  });
}

export function useRetireLibraryItem(groupId: string, itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await api.library[":itemId"].retire.$post({ param: { itemId } });
      await assertOk(res);
      return (await res.json()) as LibraryItem;
    },
    onSuccess: () => invalidateLibrary(qc, groupId, itemId),
  });
}

/**
 * Build a download URL for the current revision. Returns the API path —
 * the route 302s to a short-lived signed R2 GET, so an `<a href>` works
 * directly. Generation is just a string template, not a network call.
 */
export function libraryDownloadUrl(itemId: LibraryItemId): string {
  return `/api/v1/library/${itemId}/download`;
}

export function libraryRevisionDownloadUrl(itemId: LibraryItemId, revisionId: string): string {
  return `/api/v1/library/${itemId}/revisions/${revisionId}/download`;
}
