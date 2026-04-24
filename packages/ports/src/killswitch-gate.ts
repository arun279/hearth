export type KillswitchMode = "normal" | "read_only" | "disabled";

/**
 * Single choke-point for killswitch decisions, consumed by:
 *  - the adapter layer (defense-in-depth: every D1/R2 write calls assertWritable)
 *  - the API middleware (short-circuits writes while read_only, everything but
 *    admin + healthz while disabled)
 *  - the admin endpoint (invalidate() after flipping the flag so the new
 *    mode is visible without waiting out the cache TTL)
 */
export interface KillswitchGate {
  getMode(): Promise<KillswitchMode>;
  assertWritable(): Promise<void>;
  invalidate(): void;
}
