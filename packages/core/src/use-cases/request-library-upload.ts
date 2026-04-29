import {
  DomainError,
  INSTANCE_R2_BUDGET_TRIP_RATIO,
  INSTANCE_R2_BYTE_BUDGET,
  isAllowedLibraryMime,
  type LibraryItemId,
  type LibraryRevisionId,
  libraryKey,
  MAX_LIBRARY_ITEM_BYTES,
  type StudyGroupId,
  type UserId,
} from "@hearth/domain";
import { canAddLibraryRevision } from "@hearth/domain/policy/can-add-library-revision";
import { canUploadLibraryItem } from "@hearth/domain/policy/can-upload-library-item";
import type {
  IdGenerator,
  InstanceAccessPolicyRepository,
  LibraryItemRepository,
  ObjectStorage,
  PresignedPut,
  StudyGroupRepository,
  UploadCoordinationRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup } from "./_lib/load-viewable-group.ts";

/**
 * Either creates the next revision on an existing item, or — if `itemId`
 * is omitted — sets up a brand-new item that finalize will materialize
 * after the R2 PUT lands. Splitting "request" / "finalize" lets the
 * client upload directly to R2 and report success exactly once; an
 * abandoned upload is reaped by the hourly cron.
 */
export type RequestLibraryUploadInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly originalFilename: string | null;
  /**
   * Present when adding a revision to an existing item. Absent for new
   * uploads (the new-item flow chooses the id and the first revision id
   * server-side and returns them on `finalize`).
   */
  readonly libraryItemId?: LibraryItemId;
  readonly now: Date;
  /**
   * Optional budget overrides (typically derived from worker env at
   * the route boundary; see `LIBRARY_R2_BYTE_BUDGET` /
   * `LIBRARY_R2_BUDGET_TRIP_RATIO`). When absent, falls back to
   * `INSTANCE_R2_BYTE_BUDGET` and `INSTANCE_R2_BUDGET_TRIP_RATIO` from
   * the domain — those track the free-tier ceiling.
   */
  readonly budgetBytes?: number;
  readonly budgetTripRatio?: number;
};

export type RequestLibraryUploadDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly library: LibraryItemRepository;
  readonly storage: ObjectStorage;
  readonly uploads: UploadCoordinationRepository;
  readonly ids: IdGenerator;
};

export type RequestLibraryUploadResult = {
  readonly uploadId: string;
  readonly libraryItemId: LibraryItemId;
  readonly revisionId: LibraryRevisionId;
  readonly key: string;
  readonly upload: PresignedPut;
  readonly expiresAt: Date;
  readonly byteQuotaRemaining: number;
};

/**
 * Presigned-PUT lifetime, in seconds. 900 = 15 minutes — long enough to
 * forgive a flaky upload of the 95 MB ceiling on a slow connection
 * (≈ 64 KB/s minimum throughput), short enough that a leaked URL stops
 * working before someone can replay it. The cron sweep reaps abandoned
 * pending rows on the next hourly tick, so the row's worst-case
 * residence is one hour even if the client never retries.
 */
const TTL_SECONDS = 900;

export async function requestLibraryUpload(
  input: RequestLibraryUploadInput,
  deps: RequestLibraryUploadDeps,
): Promise<RequestLibraryUploadResult> {
  if (input.sizeBytes <= 0 || input.sizeBytes > MAX_LIBRARY_ITEM_BYTES) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Library upload must be between 1 byte and ${MAX_LIBRARY_ITEM_BYTES} bytes.`,
      "invalid_size",
    );
  }
  if (!isAllowedLibraryMime(input.mimeType)) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `MIME type ${input.mimeType} is not allowed for the library.`,
      "mime_not_allowed",
    );
  }

  const { actor, group, membership } = await loadViewableGroup(input.actor, input.groupId, deps);

  if (input.libraryItemId !== undefined) {
    const existing = await deps.library.byId(input.libraryItemId);
    if (!existing || existing.groupId !== input.groupId) {
      throw new DomainError("NOT_FOUND", "Library item not found.", "not_found");
    }
    const operator = await deps.policy.getOperator(input.actor);
    const stewards = await deps.library.listStewards(input.libraryItemId);
    const stewardSet: ReadonlySet<UserId> = new Set(stewards.map((s) => s.userId));
    const verdict = canAddLibraryRevision(
      input.actor,
      group,
      existing,
      membership,
      operator,
      stewardSet,
    );
    if (!verdict.ok) {
      throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
    }
  } else {
    const verdict = canUploadLibraryItem(actor, group, membership);
    if (!verdict.ok) {
      throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
    }
  }

  const budget = input.budgetBytes ?? INSTANCE_R2_BYTE_BUDGET;
  const ratio = input.budgetTripRatio ?? INSTANCE_R2_BUDGET_TRIP_RATIO;
  // Used-bytes is fetched after the policy gate so an unauthorized actor
  // can't probe quota state. R2's list API is O(n) over objects with a
  // 1000-page cap; v1 instances stay well within one page.
  const usedBytes = await deps.storage.usedBytes();
  const projected = usedBytes + input.sizeBytes;
  const tripAt = budget * ratio;
  if (projected > tripAt) {
    throw new DomainError(
      "INSUFFICIENT_STORAGE",
      `This upload would push instance storage past ${Math.floor(ratio * 100)}% of the byte budget.`,
      "byte_quota_exceeded",
    );
  }

  const libraryItemId = input.libraryItemId ?? (deps.ids.generate() as LibraryItemId);
  const revisionId = deps.ids.generate() as LibraryRevisionId;
  const uploadId = deps.ids.generate();
  const key = libraryKey(input.groupId, libraryItemId, revisionId);
  const expiresAt = new Date(input.now.getTime() + TTL_SECONDS * 1000);

  // Mint the presigned URL first so a transient R2 outage doesn't leave
  // a dead pending row blocking the user's retry. Signing is local
  // compute (no R2 round-trip).
  const upload = await deps.storage.putUploadPresigned({
    key,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    ttlSeconds: TTL_SECONDS,
  });

  await deps.uploads.createPending({
    id: uploadId,
    uploaderUserId: input.actor,
    groupId: input.groupId,
    context: "library",
    storageKey: key,
    declaredSizeBytes: input.sizeBytes,
    declaredMimeType: input.mimeType,
    originalFilename: input.originalFilename,
    createdAt: input.now,
    expiresAt,
  });

  return {
    uploadId,
    libraryItemId,
    revisionId,
    key,
    upload,
    expiresAt,
    byteQuotaRemaining: Math.max(0, tripAt - projected),
  };
}
