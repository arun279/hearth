import { defineConfig } from "drizzle-kit";

/**
 * The `schema` field MUST point at the barrel file, not a folder or glob.
 * Pointing at a glob while `schema.ts` also re-exports the same tables
 * causes drizzle-kit to see duplicate tables and fail silently
 * (drizzle-orm#5353, #5263, #3179).
 */
export default defineConfig({
  dialect: "sqlite",
  driver: "d1-http",
  schema: "./src/schema.ts",
  out: "./migrations",
  verbose: true,
  strict: true,
});
