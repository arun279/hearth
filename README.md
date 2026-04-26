# Hearth

A collaborative learning product for small groups who study together over time. One deployment (a _Hearth Instance_) runs independently with its own users, study groups, files, and policies.

Runs on Cloudflare Workers + D1 + R2 with Better Auth, Drizzle, and Hono on the server, and React + TanStack Router + shadcn on the client. Hexagonal architecture: `domain` and `core` are pure; `adapters` carry every framework dependency.

## Quick start

```
pnpm install
pnpm dev                # Vite SPA on :5173, Wrangler Worker on :8787
```

For full local setup (Google OAuth, `.dev.vars`, first sign-in), see [docs/dev-runbook.md](docs/dev-runbook.md).

## Scripts

- `pnpm check` — aggregate gate (resolution + biome + dprint + typecheck + arch + knip + dup + tests + integration + coverage + audit). **Run before opening a PR.**
- `pnpm typecheck` — `tsc --noEmit` across every package via Turbo
- `pnpm test` — Vitest unit suites (mock-backed)
- `pnpm test:integration` — Miniflare-hosted D1 + R2 integration tests via `@cloudflare/vitest-pool-workers`
- `pnpm test:scripts` — `node --test` over `scripts/lib/*.test.mjs` (auth-session, etc.)
- `pnpm check:coverage` — Vitest with v8 coverage instrumentation
- `pnpm e2e` — Playwright end-to-end tests against a live SPA + Worker (`apps/web/e2e/`)
- `pnpm biome check .` — lint + format check
- `pnpm format` — apply biome and dprint fixes
- `pnpm check:md` — dprint markdown formatting check
- `pnpm check:arch` — dependency-cruiser enforces package-graph import rules
- `pnpm check:knip` — dead-code / unused-dep sweep (zero-tolerance for new offenders)
- `pnpm check:dup` — jscpd duplicate-code detector
- `pnpm check:types:boundaries` — fast typecheck of `packages/{domain,core,ports}` only
- `pnpm check:conventions` — project convention greps (banned deploy patterns, etc.)
- `pnpm check:env-example` — verifies `apps/worker/.dev.vars.example` matches the runtime env schema
- `pnpm db:generate` — Drizzle migration from schema changes
- `pnpm db:migrate:dev` — apply migrations to the local D1 store
- `pnpm db:check-auth` — drift check between Better Auth's expected schema and the committed auth tables
- `pnpm local-session` — mint a dev session cookie for the local stack (canonical helper for Playwright, curl, scripts; see [`scripts/local-session.mjs`](scripts/local-session.mjs))

Run `pnpm -r run <script>` to execute a script in every package that defines it.

## Layout

```
apps/
  web/                    Vite + React SPA
  worker/                 Cloudflare Worker entry (serves SPA + API on one origin)
packages/
  domain/                 Pure types + invariants + policy/visibility predicates (SPA-importable)
  core/                   Use cases — the action layer (no I/O, deps via ports)
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

## Documentation

- [Local development setup](docs/dev-runbook.md) — Google OAuth, `.dev.vars`, first sign-in, R2 bucket setup
- [Deployment runbook](docs/deployment-runbook.md) — Cloudflare bootstrap, secrets, migrations, custom domain
- [Free-tier guardrails](docs/free-tier-guardrails.md) — killswitch, quotas, the design rationale that keeps a deployment $0
