/**
 * Ambient declarations for Vite's `?url` asset-import primitive. The
 * primitive itself is supplied at bundle time by Vite when this package
 * is consumed from a Vite-built app (`apps/web`). Declaring it here lets
 * `packages/ui` type-check without pulling Vite as a runtime dep.
 *
 * Mirrors the shape Vite ships in `vite/client.d.ts` for the same query
 * suffix: a `?url` import resolves to the public asset URL string.
 */

declare module "*?url" {
  const url: string;
  export default url;
}
