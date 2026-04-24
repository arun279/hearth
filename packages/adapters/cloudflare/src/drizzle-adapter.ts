import * as schema from "@hearth/db/schema";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";

/**
 * Build the drizzle instance + Better Auth adapter for a given D1 binding.
 *
 * This is the only file outside `packages/db` that imports `drizzle-orm` or
 * `better-auth/adapters/drizzle`. `packages/auth` receives the adapter as an
 * opaque value, so drizzle types don't leak into the auth package.
 */
export type HearthDrizzle = ReturnType<typeof drizzle<typeof schema>>;

export function createDrizzleAdapter(d1: D1Database) {
  const db = drizzle(d1, { schema });
  const authDatabase = drizzleAdapter(db, {
    provider: "sqlite",
    schema,
    usePlural: true,
  });
  return { db, authDatabase };
}

/**
 * D1's drizzle integration does not expose `.transaction()` in the version
 * we pin — multi-statement atomicity is achieved through `db.batch([...])`.
 * Write paths that need atomicity construct the statement array themselves
 * and hand it to batch(). This helper exists as a single named call site so
 * future swaps to a driver that does expose transactions (Turso, Postgres)
 * change one file rather than every write site.
 */
export async function withTx<T>(
  db: HearthDrizzle,
  fn: (tx: HearthDrizzle) => Promise<T>,
): Promise<T> {
  return fn(db);
}

const TRANSIENT_MESSAGE_PATTERN = /storage operation exceeded timeout|network connection lost/i;

function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_MESSAGE_PATTERN.test(msg);
}

/**
 * Retry a D1 operation up to 3 times with jittered exponential backoff when
 * the error matches a known transient pattern. Non-transient errors are
 * rethrown immediately so a logic error does not get masked behind retries.
 */
export async function retryTransient<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === 2) throw err;
      const delay = 50 * 2 ** attempt + Math.random() * 25;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
