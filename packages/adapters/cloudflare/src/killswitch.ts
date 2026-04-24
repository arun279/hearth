import type { KillswitchGate, KillswitchMode, SystemFlagRepository } from "@hearth/ports";

export type { KillswitchGate, KillswitchMode } from "@hearth/ports";

/**
 * Tagged error thrown when an adapter write is called while the instance is
 * in read_only or disabled mode. Callers above the adapter layer (the HTTP
 * middleware, the error mapper) pattern-match on `name === "KillswitchBlocked"`
 * to return the correct RFC 7807 envelope.
 */
export class KillswitchBlocked extends Error {
  override readonly name = "KillswitchBlocked";
  readonly mode: Exclude<KillswitchMode, "normal">;

  constructor(mode: Exclude<KillswitchMode, "normal">) {
    super(`Hearth instance is ${mode}; writes are blocked at the adapter layer.`);
    this.mode = mode;
  }
}

const CACHE_TTL_MS = 30_000;

function isKillswitchMode(value: unknown): value is KillswitchMode {
  return value === "normal" || value === "read_only" || value === "disabled";
}

/**
 * Build the gate. The cache lives in closure scope (not module scope) so
 * unit tests can construct independent gates without bleeding state.
 *
 * Clock semantics: Cloudflare Workers freeze `Date.now()` until the next
 * I/O for timing-attack mitigation. To keep the TTL honest we sample the
 * clock AFTER the D1 read in `fetchMode()`, so `readAt` reflects when the
 * flag was actually fetched — not when the caller entered `getMode`.
 *
 * `now` is an injectable clock (defaults to `Date.now`) so tests can
 * drive time deterministically without depending on wall-clock jitter.
 */
export function createKillswitchGate(
  flags: SystemFlagRepository,
  now: () => number = () => Date.now(),
): KillswitchGate {
  let cache: { mode: KillswitchMode; readAt: number } | null = null;

  const fetchMode = async (): Promise<KillswitchMode> => {
    const raw = await flags.get("killswitch_mode");
    if (raw === null) return "normal";
    return isKillswitchMode(raw) ? raw : "normal";
  };

  const getMode = async (): Promise<KillswitchMode> => {
    if (cache !== null && now() - cache.readAt < CACHE_TTL_MS) {
      return cache.mode;
    }
    const mode = await fetchMode();
    // Post-I/O clock sample — the D1 read above advanced the isolate's clock.
    cache = { mode, readAt: now() };
    return mode;
  };

  return {
    getMode,
    invalidate() {
      cache = null;
    },
    async assertWritable() {
      const mode = await getMode();
      if (mode === "read_only" || mode === "disabled") {
        throw new KillswitchBlocked(mode);
      }
    },
  };
}
