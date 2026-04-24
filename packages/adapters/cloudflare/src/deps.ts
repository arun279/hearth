import type { drizzle } from "drizzle-orm/d1";
import type { KillswitchGate } from "./killswitch.ts";

export type DrizzleD1 = ReturnType<typeof drizzle>;

export type CloudflareAdapterDeps = {
  readonly db: DrizzleD1;
  readonly storage: R2Bucket;
  /**
   * Defense-in-depth killswitch — every adapter write method calls
   * `gate.assertWritable()` before touching D1 or R2. The HTTP middleware
   * enforces the same flag at the request boundary; the adapter check
   * catches any path that bypasses the middleware (e.g., scheduled tasks).
   */
  readonly gate: KillswitchGate;
};
