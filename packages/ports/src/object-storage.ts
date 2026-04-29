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
   * `avatars/{userId}/{groupId}/{cuid2}` or
   * `library/{groupId}/{itemId}/{revisionId}`).
   */
  readonly key: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly ttlSeconds: number;
};

export type PresignedGetInput = {
  readonly key: string;
  readonly ttlSeconds: number;
  /**
   * Optional `Content-Disposition` override. R2 honours
   * `response-content-disposition` query param on signed GETs so a
   * download response can carry a friendly filename (e.g.,
   * `attachment; filename="Primer.pdf"`).
   */
  readonly contentDisposition?: string;
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

  /**
   * Mint a short-lived signed GET URL for a private R2 object. Used by
   * the library download surface so a session-authed route returns a URL
   * the browser can fetch directly. TTL is minutes-not-hours so a
   * copy-pasted URL stops working quickly; the SPA re-requests on each
   * download click.
   */
  getDownloadUrl(input: PresignedGetInput): Promise<string>;
  headObject(key: string): Promise<ObjectHead | null>;
  delete(key: string): Promise<void>;
  /**
   * Total bytes stored under `prefix` (or the full bucket if absent).
   * Used by the per-instance R2 byte-quota gauge and the killswitch's
   * 80% trip.
   */
  usedBytes(prefix?: string): Promise<number>;
}
