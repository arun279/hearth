import type { ApiRouter } from "@hearth/api/client";
import { hc } from "hono/client";

/**
 * Typed Hono `hc` client. The types are structural — no runtime code from
 * `@hearth/api` ships here. `/api` is proxied to the Worker in dev (see
 * vite.config.ts) and same-origin in production.
 *
 * `credentials: "include"` keeps Better Auth's session cookie flowing across
 * origins, which is required in dev (SPA :5173 → Worker :8787) and forward-
 * compatible with a future Electron wrap where the renderer talks to
 * hearth.wiki cross-origin.
 */
export const api = hc<ApiRouter>("/api/v1", {
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, credentials: "include" }),
});
