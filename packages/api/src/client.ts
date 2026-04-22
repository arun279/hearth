/**
 * Type-only `hc` client surface consumed by the SPA. Worker never bundles
 * this — it exists so apps/web can infer response shapes from the Hono
 * route definitions at compile time.
 */
export type { ApiRouter } from "./index.ts";
