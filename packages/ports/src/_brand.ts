/**
 * Phantom-typed marker for repository methods that mutate D1 / R2.
 *
 * A branded method signature carries an unobservable type field that
 * the killswitch-coverage test inspects via TypeScript-only mapped
 * types. The runtime shape is unchanged: a `Write<(args) => Promise<T>>`
 * is structurally identical to `(args) => Promise<T>` at runtime, so
 * adapter implementations can implement either signature freely.
 *
 * The brand turns a recurring failure mode into a compile error:
 * adding a new write method to a port without a corresponding entry
 * in the killswitch-coverage `CASES` array becomes a `tsc` error
 * rather than a test that silently passes because its explicit list
 * was never updated. See `packages/adapters/cloudflare/test/killswitch-coverage.test.ts`
 * for the consumption pattern (`satisfies Record<\`Repo.${WriteMethods<Repo>}\`, …>`).
 *
 * Migration policy: new ports brand mutating methods on creation.
 * Existing ports migrate opportunistically when a PR touches them —
 * see `docs/tripwires.md` for the rolling list.
 */

declare const __writeBrand: unique symbol;

export type Write<F> = F & { readonly [__writeBrand]: true };

/**
 * Resolve to the union of method names on `T` that carry the `Write`
 * brand. Used to constrain the killswitch-coverage CASES array to
 * exactly the set of mutating methods on a port — adding a new branded
 * method without a CASES entry produces a tsc error, removing a
 * branded method without removing the CASES entry does too.
 */
export type WriteMethods<T> = {
  [K in keyof T]: T[K] extends { readonly [__writeBrand]: true } ? K : never;
}[keyof T];

/**
 * Tag an implementation function as a write at the construction site.
 * Adapter authors wrap each mutating method in `markWrite(...)` to
 * acknowledge the gate-coverage contract — the wrapper is type-only
 * (no runtime cost) and pairs with the `gate.assertWritable()` line
 * required by resilience invariants 2 + 3.
 *
 * Example:
 *
 *     return {
 *       byId: async (id) => { ... },          // read — no brand
 *       create: markWrite(async (input) => {   // write — branded
 *         await deps.gate.assertWritable();
 *         ...
 *       }),
 *     };
 */
export function markWrite<F extends (...args: never[]) => Promise<unknown>>(fn: F): Write<F> {
  return fn as Write<F>;
}
