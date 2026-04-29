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

export type UploadStage = "idle" | "reserving" | "uploading" | "finalizing";

export type UploadProgress = {
  readonly stage: UploadStage;
  /** Bytes uploaded so far (during the "uploading" stage); 0 otherwise. */
  readonly loaded: number;
  /** Total bytes for the current upload; 0 outside the "uploading" stage. */
  readonly total: number;
};

export type UploadController = {
  /**
   * Aborts the in-flight R2 PUT (if currently uploading). The hourly
   * pending-uploads cron sweeps the orphan row + R2 object — no client-
   * side cleanup needed beyond reflecting cancel-state in the UI.
   */
  cancel(): void;
};

class UploadAbortedError extends Error {
  constructor() {
    super("Upload was cancelled.");
    this.name = "UploadAbortedError";
  }
}

export function isUploadAbortedError(err: unknown): err is UploadAbortedError {
  return err instanceof UploadAbortedError;
}

const libraryListKey = (groupId: string) => ["library", "list", groupId] as const;
const libraryItemKey = (itemId: string) => ["library", "item", itemId] as const;

function invalidateLibrary(qc: QueryClient, groupId: string, itemId?: string) {
  qc.invalidateQueries({ queryKey: libraryListKey(groupId) });
  qc.invalidateQueries({ queryKey: ["library", "search", groupId] });
  qc.invalidateQueries({ queryKey: ["library", "quota", groupId] });
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

type LibrarySearchResult = {
  readonly entries: readonly LibraryListEntry[];
  readonly nextCursor: string | null;
};

const librarySearchKey = (groupId: string, query: string) =>
  ["library", "search", groupId, query] as const;

/**
 * Search the group's library by title, description, or tag value.
 * `query` is the live, undebounced input — the caller is responsible
 * for debouncing and gating `enabled` on a non-empty query so this hook
 * stays a pure cache. The use case treats too-short queries as 200 +
 * empty, so it's safe to leave `enabled` true for one- or two-character
 * inputs; gating off the empty case is purely an optimization to keep
 * the network panel quiet during clears.
 */
export function useLibrarySearch(groupId: string, query: string, enabled: boolean) {
  return useQuery({
    queryKey: librarySearchKey(groupId, query),
    enabled,
    queryFn: async (): Promise<LibrarySearchResult> => {
      const res = await api.g[":groupId"].library.search.$get({
        param: { groupId },
        query: { q: query },
      });
      await assertOk(res);
      return (await res.json()) as LibrarySearchResult;
    },
    // Search results are fresh per keystroke; once the user types more,
    // this entry is replaced rather than refetched. A short staleTime
    // keeps a transient back-button to the library out of the network
    // panel.
    staleTime: 30_000,
  });
}

type LibraryQuotaResult = {
  readonly usedBytes: number;
  readonly budgetBytes: number;
  readonly availableBytes: number;
  readonly tripRatio: number;
  readonly maxItemBytes: number;
};

export function useLibraryQuota(groupId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["library", "quota", groupId] as const,
    enabled,
    queryFn: async (): Promise<LibraryQuotaResult> => {
      const res = await api.g[":groupId"].library.quota.$get({ param: { groupId } });
      await assertOk(res);
      return (await res.json()) as LibraryQuotaResult;
    },
    // Quota changes only on uploads / cron sweeps; per-mutation
    // invalidation already covers the upload path. A 1-min staletime
    // keeps the dropzone gauge fresh without burning round-trips on
    // every dialog open.
    staleTime: 60_000,
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

type UploadInput = {
  readonly file: File;
  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  /** When set, finalize appends a revision to the existing item. */
  readonly libraryItemId?: string;
  /** Notified on each XHR `progress` tick during the R2 PUT step. */
  readonly onProgress?: (progress: UploadProgress) => void;
  /** Receives a cancel handle once the R2 PUT begins. */
  readonly onController?: (controller: UploadController) => void;
};

/**
 * The four-step direct-to-R2 upload, as one mutation:
 *   1. POST /g/:groupId/library/upload-request → presigned PUT URL +
 *      coordination row.
 *   2. PUT directly to R2 via `XMLHttpRequest` so `xhr.upload.onprogress`
 *      surfaces real bytes-uploaded data — `fetch` doesn't expose that
 *      yet in any browser, and a 95 MB upload with a single spinner is
 *      the difference between "still working" and "stalled?". The PUT
 *      uses `withCredentials = false` (R2 is cross-origin in prod and
 *      `credentials: "omit"` is the equivalent for XHR), so our session
 *      cookie never leaks cross-origin.
 *   3. POST /library/finalize materializes the item + revision rows and
 *      drops the pending row.
 *
 * Cancel is wired through the XHR `abort()`. The hourly pending-uploads
 * cron sweeps the orphan row + R2 object on the next tick.
 */
export function useUploadLibraryItem(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UploadInput) => {
      input.onProgress?.({ stage: "reserving", loaded: 0, total: 0 });
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

      const total = input.file.size;
      input.onProgress?.({ stage: "uploading", loaded: 0, total });
      await putViaXhr({
        url: requested.upload.url,
        body: input.file,
        headers: requested.upload.requiredHeaders,
        onProgress: (loaded) => input.onProgress?.({ stage: "uploading", loaded, total }),
        onController: input.onController,
      });

      input.onProgress?.({ stage: "finalizing", loaded: total, total });
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

type PutViaXhrInput = {
  readonly url: string;
  readonly body: Blob;
  readonly headers: Readonly<Record<string, string>>;
  readonly onProgress?: (loaded: number) => void;
  readonly onController?: (controller: UploadController) => void;
};

function putViaXhr(opts: PutViaXhrInput): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", opts.url, true);
    xhr.withCredentials = false;
    for (const [name, value] of Object.entries(opts.headers)) {
      xhr.setRequestHeader(name, value);
    }
    let aborted = false;
    opts.onController?.({
      cancel() {
        if (xhr.readyState !== XMLHttpRequest.DONE) {
          aborted = true;
          xhr.abort();
        }
      },
    });
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Storage rejected the upload (${xhr.status}).`));
      }
    };
    xhr.onerror = () => {
      reject(
        new Error(
          "Couldn't reach storage. Check your connection and try again, or pick the file again if the upload window expired.",
        ),
      );
    };
    xhr.onabort = () => {
      reject(aborted ? new UploadAbortedError() : new Error("Upload was interrupted."));
    };
    xhr.send(opts.body);
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
