import type { ObjectHead, ObjectStorage } from "@hearth/ports";
import type { KillswitchGate } from "./killswitch.ts";

export function createObjectStorage(bucket: R2Bucket, gate: KillswitchGate): ObjectStorage {
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
    // TODO(scaffolding): R2 presigned-URL generation. Implement via the S3
    // compatibility layer (AWS4 signer) or Cloudflare's native getSignedUrl
    // when the upload flow is wired.
    async getDownloadUrl(_key, _ttlSeconds) {
      throw new Error("Not implemented: R2 signed URL generation");
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
