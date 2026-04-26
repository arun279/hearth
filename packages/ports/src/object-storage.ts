export type ObjectMetadata = {
  readonly contentType?: string;
  readonly originalFilename?: string;
};

export type ObjectHead = {
  readonly size: number;
  readonly contentType?: string;
  readonly uploadedAt: Date;
};

export type PresignedPutInput = {
  /**
   * Full R2 key the upload is bound to. The presigned URL is invalid for
   * any other key, so callers MUST pass the canonical key (e.g.,
   * `avatars/{userId}/{groupId}/{cuid2}` or `library/{itemId}/{revisionId}`).
   */
  readonly key: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly ttlSeconds: number;
};

export type PresignedPut = {
  readonly url: string;
  /** Headers the client MUST send on the PUT — ties the URL to size + mime. */
  readonly requiredHeaders: Readonly<Record<string, string>>;
};

export interface ObjectStorage {
  /**
   * Stream-bounded upload (server-side). Used by tests and any future
   * server-mediated path. M3 onwards the canonical client path is the
   * presigned PUT below.
   */
  putUpload(
    key: string,
    stream: ReadableStream<Uint8Array>,
    metadata?: ObjectMetadata,
  ): Promise<void>;

  /**
   * Mint a short-lived URL the client uploads directly to. The signature
   * binds the exact key + content-length + content-type so a client cannot
   * upload a different file or a different size to the same URL. TTL is
   * minutes-not-hours so a leaked URL is short-lived.
   */
  putUploadPresigned(input: PresignedPutInput): Promise<PresignedPut>;

  getDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  headObject(key: string): Promise<ObjectHead | null>;
  delete(key: string): Promise<void>;
  usedBytes(prefix?: string): Promise<number>;
}
