import { pendingUploads } from "@hearth/db/schema";
import type { StudyGroupId, UserId } from "@hearth/domain";
import type {
  CreatePendingUploadInput,
  PendingUpload,
  UploadContext,
  UploadCoordinationRepository,
} from "@hearth/ports";
import { eq } from "drizzle-orm";
import type { CloudflareAdapterDeps } from "./deps.ts";

function toPendingUpload(r: typeof pendingUploads.$inferSelect): PendingUpload {
  return {
    id: r.id,
    uploaderUserId: r.uploaderUserId as UserId,
    groupId: r.groupId as StudyGroupId,
    context: r.context as UploadContext,
    storageKey: r.revisionId,
    declaredSizeBytes: r.declaredSizeBytes,
    declaredMimeType: r.declaredMimeType,
    originalFilename: r.originalFilename,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  };
}

/**
 * Coordination row for the direct-to-R2 upload flow. The row is purely
 * ephemeral: created at presign-time, deleted at finalize-time or by the
 * hourly orphan sweep. It does not represent a domain entity — only the
 * coordination metadata between the client's PUT and the eventual
 * downstream write (avatar / library / pending contribution).
 *
 * `revisionId` doubles as the R2 storage key. Re-using the column keeps
 * the schema lean for v1; a richer split arrives if we add per-context
 * indexing in M6+.
 */
export function createUploadCoordinationRepository(
  deps: Pick<CloudflareAdapterDeps, "db" | "gate">,
): UploadCoordinationRepository {
  return {
    async createPending(input: CreatePendingUploadInput) {
      await deps.gate.assertWritable();
      await deps.db.insert(pendingUploads).values({
        id: input.id,
        uploaderUserId: input.uploaderUserId,
        groupId: input.groupId,
        libraryItemId: null,
        revisionId: input.storageKey,
        declaredSizeBytes: input.declaredSizeBytes,
        declaredMimeType: input.declaredMimeType,
        originalFilename: input.originalFilename,
        context: input.context,
        pendingContributionId: null,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
      });
    },

    async getPending(id) {
      const rows = await deps.db
        .select()
        .from(pendingUploads)
        .where(eq(pendingUploads.id, id))
        .limit(1);
      return rows[0] ? toPendingUpload(rows[0]) : null;
    },

    async deletePending(id) {
      await deps.gate.assertWritable();
      await deps.db.delete(pendingUploads).where(eq(pendingUploads.id, id));
    },
  };
}
