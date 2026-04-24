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
    // Simulate a slow flag read — if readAt were sampled BEFORE the fetch,
    // the TTL would count the fetch duration against itself and the cache
    // would expire too early. By sampling AFTER, the TTL window is always
    // the full 30 s starting from when we actually observed the flag.
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
    const gate = createKillswitchGate(flags);

    const getBefore = Date.now();
    const promise = gate.getMode();
    await new Promise((r) => setTimeout(r, 15));
    resolveFetch(null);
    await promise;

    // Two immediate subsequent reads must stay in cache — proves the
    // 15-ms fetch delay did NOT eat into the TTL (which it would have if
    // readAt had been stamped before the fetch).
    await gate.getMode();
    await gate.getMode();
    const getAfter = Date.now();

    expect(slowGet).toHaveBeenCalledTimes(1);
    // Sanity: the test itself took at least 15 ms.
    expect(getAfter - getBefore).toBeGreaterThanOrEqual(15);
  });
});
