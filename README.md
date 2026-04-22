# Hearth

A collaborative learning product for small groups who study together over time. One deployment (a *Hearth Instance*) runs independently with its own users, study groups, files, and policies.

## Quick start

```
pnpm install
pnpm dev                # Vite SPA on :5173, Wrangler Worker on :8787
```

## Scripts

- `pnpm typecheck` — `tsc --noEmit` across every package via Turbo
- `pnpm test` — Vitest (with `@cloudflare/vitest-pool-workers` for worker tests)
- `pnpm biome check .` — format + lint
- `pnpm check:arch` — dependency-cruiser enforces package-graph import rules
- `pnpm check:knip` — dead-code / unused-dep sweep (zero-tolerance for new offenders)
- `pnpm check:types:boundaries` — fast typecheck of `packages/{domain,core,ports}` only
- `pnpm check:conventions` — project convention greps (banned deploy patterns, etc.)
- `pnpm check:env-example` — verifies `apps/worker/.dev.vars.example` matches the runtime env schema
- `pnpm check:table-inventory` — asserts the schema's table set matches the canonical list
- `pnpm db:generate` — Drizzle migration from schema changes
- `pnpm db:migrate:dev` — apply migrations to local Miniflare D1
- `pnpm db:check-auth` — drift check between Better Auth's expected schema and the committed auth tables

Run `pnpm -r run <script>` to execute a script in every package that defines it.

## Layout

```
apps/
  web/                    Vite + React SPA
  worker/                 Cloudflare Worker entry (serves SPA + API on one origin)
packages/
  domain/                 Pure types + invariants + policy/visibility predicates (SPA-importable)
  core/                   Use cases (UploadLibraryItem, EnrollInTrack, ArchiveTrack…)
  ports/                  Domain-shaped repository and infrastructure interfaces
  adapters/cloudflare/    D1 repos, R2 storage, Cron scheduler, Rate limit, Usage poller
  api/                    Hono routes + hc client type export
  auth/                   Better Auth factory + admission hooks
  ui/                     shadcn components + Tailwind v4
  config/                 Zod 4 env schema
  db/                     Drizzle schema + migrations
  tsconfig/               Shared tsconfig base + framework variants
```

## Deployment

Target origin: `https://hearth.wiki` — a single Worker serves the SPA via Static Assets and the API under `/api/v1/*` and `/api/auth/*`. Atomic versioned deploys via `wrangler versions upload` + `wrangler versions deploy`. Rollback: `wrangler rollback`.
