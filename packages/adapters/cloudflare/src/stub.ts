/**
 * Build a stub implementation of any port interface. Every method access
 * returns a function that throws with a useful message — so the ports
 * object can be constructed (and passed through middleware) without
 * blowing up, but any attempt to actually USE a stub method fails loudly.
 *
 * Satisfies the type at the usage site via an unchecked cast; the runtime
 * shape is a Proxy that intercepts every property access.
 *
 * TODO(m18): remove this helper once every repository has a real
 * implementation. The last consumer is `User.deleteIdentity` (M18); the
 * intermediate landings are `ActivityRecordRepository` (M11) and
 * `StudySessionRepository` (M13). The stub exists to keep the
 * composition root functional while adapters are skeletons.
 */
export function stubRepository<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get: (_target, method) => {
      if (typeof method === "symbol") return undefined;
      if (method === "then") return undefined; // so `await repo` doesn't hang
      return () => {
        throw new Error(`Not implemented: ${name}.${String(method)} — scaffold stub`);
      };
    },
  });
}
