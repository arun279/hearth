import { isAvatarKey, isLibraryKey } from "@hearth/domain";
import type { ObjectHead, ObjectStorage, PresignedPut, PresignedPutInput } from "@hearth/ports";
import { AwsClient } from "aws4fetch";
import type { KillswitchGate } from "./killswitch.ts";

export type ObjectStorageConfig = {
  /**
   * Public S3-compatibility endpoint for presigned URL minting. Path-style:
   * `https://{accountId}.r2.cloudflarestorage.com`. The account id comes
   * from the worker's R2_ACCOUNT_ID secret.
   */
  readonly endpoint: string;
  /** R2 S3-compat credentials (account-token-scoped, never user-scoped). */
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Bucket name on R2 (e.g. `hearth-storage`). */
  readonly bucket: string;
  /**
   * Maximum signed expiry. R2 / S3 cap it at 604800 s (7 days); we clamp
   * lower than that for ergonomic safety. The avatar / library use cases
   * pass shorter values still (15 min for now).
   */
  readonly maxExpirySeconds: number;
};

/**
 * R2 binding-only object storage. Mutation methods call `gate.assertWritable()`
 * before touching R2 so the killswitch's read-only / disabled modes also
 * block storage writes (defense in depth — the HTTP middleware enforces the
 * same flag at the request boundary).
 *
 * `putUploadPresigned` does NOT call `assertWritable` itself; the use case
 * that mints presigned URLs is responsible for that gate (it also writes a
 * row to `pending_uploads`, which IS gated). Decoupling here keeps the
 * presign helper a pure compute operation — no hidden D1 read.
 *
 * Single-PUT signing covers up to R2's 5 GB cap. If multipart is ever needed
 * for resumable uploads, add separate `createMultipartUpload` /
 * `uploadPart` port methods rather than overloading this one.
 */
export function createObjectStorage(
  bucket: R2Bucket,
  gate: KillswitchGate,
  config: ObjectStorageConfig,
): ObjectStorage {
  const aws = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });

  return {
    async putUpload(key, stream, metadata) {
      await gate.assertWritable();
      await bucket.put(key, stream, {
        httpMetadata: metadata ? { contentType: metadata.contentType } : undefined,
        customMetadata: metadata?.originalFilename
          ? { originalFilename: metadata.originalFilename }
          : undefined,
      });
    },

    async putUploadPresigned({
      key,
      mimeType,
      sizeBytes,
      ttlSeconds,
    }: PresignedPutInput): Promise<PresignedPut> {
      // Caller validates `key` shape via assertAvatarKey / assertLibraryKey.
      // Re-checking the canonical predicates here keeps the adapter
      // defensive against use-case bugs that bypass the assert helper.
      if (!isAvatarKey(key) && !isLibraryKey(key)) {
        throw new Error("Refusing to sign URL for unknown key prefix");
      }
      if (sizeBytes <= 0) {
        throw new Error("sizeBytes must be positive");
      }
      const expirySeconds = Math.min(Math.max(ttlSeconds, 1), config.maxExpirySeconds);

      // Path-style URL — matches Cloudflare's documented R2 example. The
      // signed request encodes the bucket as the first path segment, the
      // key as the rest, and binds `host` + `content-type` into the
      // signature so a client cannot upload a different MIME type to the
      // same URL.
      const target = `${config.endpoint}/${config.bucket}/${encodeKey(key)}?X-Amz-Expires=${expirySeconds}`;
      const signed = await aws.sign(
        new Request(target, {
          method: "PUT",
          headers: { "Content-Type": mimeType },
        }),
        { aws: { signQuery: true } },
      );

      return {
        url: signed.url,
        // The client MUST send these exact header values on the PUT —
        // mismatched Content-Type yields a 403 SignatureDoesNotMatch.
        // Content-Length is not signed (S3 doesn't sign it by default),
        // so size enforcement happens at finalize via headObject().
        requiredHeaders: { "Content-Type": mimeType },
      };
    },

    async getDownloadUrl(_key, _ttlSeconds) {
      // Reads use the bucket's public origin (R2_PUBLIC_ORIGIN) — short-
      // lived signed GETs are unnecessary for v1's public assets. When a
      // private-asset use case lands, sign with `aws.sign(..., { signQuery:
      // true })` here following the same shape as the PUT above.
      throw new Error("Not implemented: signed GET URLs not yet wired");
    },

    async headObject(key): Promise<ObjectHead | null> {
      const head = await bucket.head(key);
      if (!head) return null;
      return {
        size: head.size,
        contentType: head.httpMetadata?.contentType,
        uploadedAt: head.uploaded,
      };
    },

    async delete(key) {
      await gate.assertWritable();
      await bucket.delete(key);
    },

    async usedBytes(prefix) {
      let total = 0;
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix, cursor, limit: 1000 });
        for (const obj of page.objects) total += obj.size;
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return total;
    },
  } satisfies ObjectStorage;
}

/**
 * Percent-encode each path segment (preserving `/`). aws4fetch signs the
 * exact URL we hand it, so encoding mistakes silently produce 403s.
 */
function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
