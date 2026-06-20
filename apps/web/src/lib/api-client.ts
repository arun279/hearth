import type { ApiRouter } from "@hearth/api/client";
import { hc } from "hono/client";

/**
 * Typed Hono `hc` client. The types are structural — no runtime code from
 * `@hearth/api` ships here. `/api` is proxied to the Worker in dev (see
 * vite.config.ts) and same-origin in production.
 *
 * The base is anchored to the page origin so the client's `$url` helper (which
 * builds an absolute `new URL(...)`) resolves — a relative base makes `$url`
 * throw, and `$put`/`$get` still emit a same-origin URL the dev Vite proxy and
 * the production Worker both serve. `globalThis.location` is read defensively
 * because SSR-string component tests evaluate this module on Node, where there
 * is no `location`; there the base falls back to the relative `/api/v1` (those
 * tests never call `$url`).
 *
 * `credentials: "include"` keeps Better Auth's session cookie flowing across
 * origins, which is required in dev (SPA :5173 → Worker :8787) and forward-
 * compatible with a future Electron wrap where the renderer talks to
 * hearth.wiki cross-origin.
 */
export const api = hc<ApiRouter>(`${globalThis.location?.origin ?? ""}/api/v1`, {
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, credentials: "include" }),
});
