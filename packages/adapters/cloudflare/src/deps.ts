import type { drizzle } from "drizzle-orm/d1";

export type DrizzleD1 = ReturnType<typeof drizzle>;

export type CloudflareAdapterDeps = {
  readonly db: DrizzleD1;
  readonly storage: R2Bucket;
};
