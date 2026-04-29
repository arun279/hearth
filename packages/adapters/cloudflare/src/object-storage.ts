import { isAvatarKey, isLibraryKey } from "@hearth/domain";
import {
  buildDevProxyGetUrl,
  buildDevProxyPutUrl,
  signDevProxy,
} from "@hearth/domain/dev-r2-signing";
import type {
  ObjectHead,
  ObjectStorage,
  PresignedGetInput,
  PresignedPut,
  PresignedPutInput,
} from "@hearth/ports";
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
  /**
   * Dev-mode override. When provided, the adapter signs URLs that point
   * back at the worker itself (Miniflare's R2 simulator is binding-only
   * and doesn't expose an S3 endpoint a browser can PUT to). Production
   * leaves this undefined; the aws4fetch path takes over.
   *
   * `baseUrl` is the worker's public origin (e.g. `http://localhost:8787`).
   * `secret` is HMAC'd into every signed URL so the dev proxy routes can
   * verify a URL came from the worker before honouring it. Reusing
   * `BETTER_AUTH_SECRET` is fine — it's already a 32+ char HMAC key
   * scoped to this instance.
   */
  readonly devProxy?: {
    readonly baseUrl: string;
    readonly secret: string;
  };
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

      if (config.devProxy) {
        const expiresAtMs = Date.now() + expirySeconds * 1000;
        const sig = await signDevProxy(
          { method: "PUT", key, expiresAtMs, contentType: mimeType },
          config.devProxy.secret,
        );
        return {
          url: buildDevProxyPutUrl({
            baseUrl: config.devProxy.baseUrl,
            key,
            expiresAtMs,
            contentType: mimeType,
            signature: sig,
          }),
          requiredHeaders: { "Content-Type": mimeType },
        };
      }

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

    async getDownloadUrl({ key, ttlSeconds, contentDisposition }: PresignedGetInput) {
      // Avatars sit on the public read origin; private library bodies need
      // a signed GET so the URL only works for the actor who requested it
      // (within the TTL). Refuse anything that isn't a known prefix —
      // matches the defensive check on the PUT side and stops a use-case
      // bug from accidentally signing arbitrary keys.
      if (!isAvatarKey(key) && !isLibraryKey(key)) {
        throw new Error("Refusing to sign URL for unknown key prefix");
      }
      const expirySeconds = Math.min(Math.max(ttlSeconds, 1), config.maxExpirySeconds);

      if (config.devProxy) {
        const expiresAtMs = Date.now() + expirySeconds * 1000;
        const sig = await signDevProxy({ method: "GET", key, expiresAtMs }, config.devProxy.secret);
        return buildDevProxyGetUrl({
          baseUrl: config.devProxy.baseUrl,
          key,
          expiresAtMs,
          signature: sig,
          ...(contentDisposition !== undefined ? { contentDisposition } : {}),
        });
      }

      // R2 / S3 honour `response-content-disposition` on signed GETs to
      // override the saved object's disposition for this download only.
      const params = new URLSearchParams({ "X-Amz-Expires": String(expirySeconds) });
      if (contentDisposition) {
        params.set("response-content-disposition", contentDisposition);
      }
      const target = `${config.endpoint}/${config.bucket}/${encodeKey(key)}?${params.toString()}`;
      const signed = await aws.sign(new Request(target, { method: "GET" }), {
        aws: { signQuery: true },
      });
      return signed.url;
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
