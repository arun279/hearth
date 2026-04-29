import { avatarKey, DomainError, type StudyGroupId, type UserId } from "@hearth/domain";
import { canUpdateOwnGroupProfile } from "@hearth/domain/policy/can-update-own-group-profile";
import type {
  IdGenerator,
  InstanceAccessPolicyRepository,
  ObjectStorage,
  PresignedPut,
  StudyGroupRepository,
  UploadCoordinationRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup } from "./_lib/load-viewable-group.ts";

export type RequestAvatarUploadInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly now: Date;
};

export type RequestAvatarUploadDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly storage: ObjectStorage;
  readonly uploads: UploadCoordinationRepository;
  readonly ids: IdGenerator;
};

export type RequestAvatarUploadResult = {
  readonly uploadId: string;
  readonly key: string;
  readonly upload: PresignedPut;
  readonly expiresAt: Date;
};

const MAX_AVATAR_BYTES = 512 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const TTL_SECONDS = 900;

/**
 * Mint a presigned PUT URL for an avatar upload. The use case enforces
 * self-only target, size + MIME limits, and the killswitch gate (via the
 * coordination port). Returns an `uploadId` the client passes to
 * `finalize-avatar-upload` after the PUT lands. The 15-minute TTL is
 * short enough to make a leaked URL low-impact and long enough to forgive
 * flaky uploads.
 */
export async function requestAvatarUpload(
  input: RequestAvatarUploadInput,
  deps: RequestAvatarUploadDeps,
): Promise<RequestAvatarUploadResult> {
  const { actor, group, membership } = await loadViewableGroup(input.actor, input.groupId, deps);

  const verdict = canUpdateOwnGroupProfile(actor, group, membership, input.actor);
  if (!verdict.ok) {
    throw new DomainError("FORBIDDEN", verdict.reason.message, verdict.reason.code);
  }

  if (input.sizeBytes <= 0 || input.sizeBytes > MAX_AVATAR_BYTES) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Avatar must be between 1 byte and ${MAX_AVATAR_BYTES} bytes.`,
      "invalid_avatar_size",
    );
  }
  if (!ALLOWED_MIME.has(input.mimeType)) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Avatar MIME type ${input.mimeType} is not allowed. Use png, jpeg, or webp.`,
      "invalid_avatar_mime",
    );
  }

  const uploadId = deps.ids.generate();
  const cuid = deps.ids.generate();
  const key = avatarKey(input.actor, input.groupId, cuid);
  const expiresAt = new Date(input.now.getTime() + TTL_SECONDS * 1000);

  // Mint the presigned URL first so a transient R2 outage doesn't leave a
  // dead pending row blocking the user's retry. Signing is local compute
  // (no R2 round-trip) so the failure surface is narrow.
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
    context: "avatar",
    storageKey: key,
    declaredSizeBytes: input.sizeBytes,
    declaredMimeType: input.mimeType,
    originalFilename: null,
    createdAt: input.now,
    expiresAt,
  });

  return { uploadId, key, upload, expiresAt };
}
