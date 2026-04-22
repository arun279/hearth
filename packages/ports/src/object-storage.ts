export type ObjectMetadata = {
  readonly contentType?: string;
  readonly originalFilename?: string;
};

export type ObjectHead = {
  readonly size: number;
  readonly contentType?: string;
  readonly uploadedAt: Date;
};

export interface ObjectStorage {
  putUpload(
    key: string,
    stream: ReadableStream<Uint8Array>,
    metadata?: ObjectMetadata,
  ): Promise<void>;
  getDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  headObject(key: string): Promise<ObjectHead | null>;
  delete(key: string): Promise<void>;
  usedBytes(prefix?: string): Promise<number>;
}
