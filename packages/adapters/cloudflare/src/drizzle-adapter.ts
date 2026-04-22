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
