/**
 * Better Auth schema-drift guard — CLI-only entrypoint.
 *
 * Loaded by `pnpm --filter @hearth/db db:check-auth`, which invokes
 * `@better-auth/cli generate --config scripts/check-auth.config.ts`. The
 * CLI's generator reads the `auth` instance's options + adapter metadata
 * (provider, usePlural, schema) to emit the Drizzle schema that Better
 * Auth currently expects. A companion diff script then compares that
 * expected schema against the hand-written `packages/db/src/auth-tables.ts`
 * and fails the check on column-set drift.
 *
 * Why this file lives here rather than in a package:
 *   - `packages/auth` is CI-forbidden from importing drizzle-orm; the
 *     Drizzle adapter below can't live there.
 *   - `packages/db`'s arch rules do not forbid depending on @hearth/auth,
 *     but dropping a CLI shim inside the published surface of a workspace
 *     package would pollute the runtime dep graph needlessly.
 *   - `scripts/` is outside dep-cruiser's `packages apps` scan, so a
 *     one-file CLI config that bridges auth + db does not establish a
 *     new package edge that governance would need to approve.
 *
 * The `stubDb` below is never queried — the CLI's `generate` command only
 * inspects adapter metadata (`provider`, `usePlural`, the schema object's
 * exported tables). Passing a bare object cast to the expected type keeps
 * us off real D1 at generate time.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { authOptions } from "../packages/auth/src/auth-options.ts";
import * as authSchema from "../packages/db/src/auth-tables.ts";

// `generate` inspects adapter metadata only; stubDb is never queried.
type DrizzleAdapterDb = Parameters<typeof drizzleAdapter>[0];
const stubDb = {} as DrizzleAdapterDb;

export const auth = betterAuth({
  ...authOptions,
  database: drizzleAdapter(stubDb, {
    provider: "sqlite",
    schema: authSchema,
    usePlural: true,
  }),
});
