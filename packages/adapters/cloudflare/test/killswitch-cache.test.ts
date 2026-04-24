import type { SystemFlagRepository } from "@hearth/ports";
import { describe, expect, it, vi } from "vitest";
import { createKillswitchGate } from "../src/killswitch.ts";

/**
 * Behavioral guarantees of the gate's cache, covering the corner cases
 * documented in src/killswitch.ts:
 *
 *  - `fetchMode` is called at most once within the TTL window.
 *  - `invalidate()` drops the cache so the next read hits the flag store.
 *  - `readAt` is sampled AFTER the fetch so the TTL reflects the flag's
 *    actual observation time, not the caller's entry time (important on
 *    Cloudflare Workers where `Date.now()` freezes until the next I/O).
 */
describe("killswitch gate cache", () => {
  function makeFlags(value: string | null): SystemFlagRepository {
    return {
      get: vi.fn(async () => value),
      set: vi.fn(),
      list: vi.fn(async () => []),
    };
  }

  it("caches the mode within the TTL window", async () => {
    const flags = makeFlags(null);
    const gate = createKillswitchGate(flags);

    await gate.getMode();
    await gate.getMode();
    await gate.getMode();

    expect(flags.get).toHaveBeenCalledTimes(1);
  });

  it("invalidate() forces a re-read", async () => {
    const flags = makeFlags(null);
    const gate = createKillswitchGate(flags);

    await gate.getMode();
    gate.invalidate();
    await gate.getMode();

    expect(flags.get).toHaveBeenCalledTimes(2);
  });

  it("treats a missing flag as 'normal'", async () => {
    const gate = createKillswitchGate(makeFlags(null));
    expect(await gate.getMode()).toBe("normal");
  });

  it("treats an unrecognized flag value as 'normal' (fail-safe)", async () => {
    const gate = createKillswitchGate(makeFlags("bogus"));
    expect(await gate.getMode()).toBe("normal");
  });

  it("assertWritable throws KillswitchBlocked when mode is read_only", async () => {
    const gate = createKillswitchGate(makeFlags("read_only"));
    await expect(gate.assertWritable()).rejects.toMatchObject({
      name: "KillswitchBlocked",
      mode: "read_only",
    });
  });

  it("assertWritable throws KillswitchBlocked when mode is disabled", async () => {
    const gate = createKillswitchGate(makeFlags("disabled"));
    await expect(gate.assertWritable()).rejects.toMatchObject({
      name: "KillswitchBlocked",
      mode: "disabled",
    });
  });

  it("samples readAt AFTER fetch so TTL reflects observation time", async () => {
    // If readAt were sampled BEFORE the fetch, the TTL would count the
    // fetch duration against itself and the cache could be stored already
    // stale. Sampling AFTER means the 30 s TTL window always begins when
    // we actually observed the flag.
    let t = 1_000_000;
    const now = () => t;

    let resolveFetch: (v: null) => void = () => {};
    const slowGet = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const flags: SystemFlagRepository = {
      get: slowGet,
      set: vi.fn(),
      list: vi.fn(async () => []),
    };
    const gate = createKillswitchGate(flags, now);

    const promise = gate.getMode();
    // Advance the injected clock past the 30 s TTL before the fetch
    // resolves — this is the only regime where the two sampling
    // strategies diverge. BEFORE-sampling would stamp readAt=1_000_000
    // and see now-readAt=40_000 > 30_000 on the next read → expired,
    // re-fetches. AFTER-sampling stamps readAt=1_040_000 → cache live.
    t += 40_000;
    resolveFetch(null);
    await promise;

    await gate.getMode();
    await gate.getMode();

    expect(slowGet).toHaveBeenCalledTimes(1);
  });
});
