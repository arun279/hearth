import { pendingUploads } from "@hearth/db/schema";
import { eq, lt } from "drizzle-orm";
import type { CloudflareAdapterDeps } from "./deps.ts";

/**
 * Hourly sweep for the `pending_uploads` table. Finds rows whose presigned
 * upload window has passed without a finalize call and reclaims the orphan
 * R2 object (best-effort) plus the row.
 *
 * The sweep is idempotent: a row whose R2 object never landed (client
 * abandoned the upload) and a row whose object did land but was never
 * finalized both clean up the same way — `bucket.delete()` on a missing
 * key is a no-op in R2.
 *
 * Failure mode: if R2 errors mid-sweep we throw — the cron retries on the
 * next firing. We intentionally do NOT swallow errors here; surfacing them
 * to Sentry is the operator's signal that something is wrong with R2.
 */
export function createPendingUploadsSweep(
  deps: Pick<CloudflareAdapterDeps, "db" | "storage" | "gate">,
) {
  return async function sweep(now: Date): Promise<{ swept: number }> {
    await deps.gate.assertWritable();

    // Read in a bounded page so a single firing never holds the connection
    // for an unbounded number of rows. The cron fires hourly so backlogs
    // catch up over a few firings; the table's `expires_at` index keeps
    // the lookup O(log n).
    const expired = await deps.db
      .select({
        id: pendingUploads.id,
        revisionId: pendingUploads.revisionId,
        context: pendingUploads.context,
      })
      .from(pendingUploads)
      .where(lt(pendingUploads.expiresAt, now))
      .limit(200);

    if (expired.length === 0) return { swept: 0 };

    // R2 deletes happen first, in parallel — bucket.delete() is no-op on a
    // missing key so it's safe to re-run if the row stays. Then a single
    // batch DELETE drops the now-orphaned rows.
    await Promise.allSettled(
      expired.map(async (row) => {
        try {
          await deps.storage.delete(row.revisionId);
        } catch (err) {
          // Surface to Sentry; we still drop the DB row because keeping
          // it would just delay the next attempt for the same orphan.
          console.error("pending-uploads sweep: R2 delete failed", { id: row.id, err });
        }
      }),
    );
    // The expired list is non-empty (length-checked above), so the
    // tuple cast is safe. Drizzle's batch typing requires a non-empty
    // tuple; we widen via `unknown` because the inferred element type
    // changes per call site and is not exported.
    const statements = expired.map((row) =>
      deps.db.delete(pendingUploads).where(eq(pendingUploads.id, row.id)),
    );
    await deps.db.batch(statements as unknown as Parameters<typeof deps.db.batch>[0]);
    return { swept: expired.length };
  };
}
