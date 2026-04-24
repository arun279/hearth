# Agent entry point

Discoverable hook for any agent writing code in this repo. Keep it under 200 lines; it links outward rather than duplicating content.

## Package graph (respect the arrows)

```
apps/web          → packages/ui, packages/domain (policy + visibility + types)
apps/worker       → packages/api, packages/auth, packages/adapters/cloudflare, packages/config
packages/api      → packages/core, packages/ports
packages/auth     → packages/ports, packages/domain, better-auth  (NEVER drizzle, NEVER adapters)
packages/core     → packages/domain, packages/ports, zod           (nothing else)
packages/adapters/cloudflare → packages/ports, packages/db, drizzle-orm, @cloudflare/workers-types, @paralleldrive/cuid2
packages/domain   → (leaf — pure TS, no runtime deps)
packages/ports    → packages/domain  (pure interfaces)
```

These rules are enforced by `pnpm check:arch` (dependency-cruiser) in CI. Files under `packages/domain/src/policy/**` and `packages/domain/src/visibility/**` must additionally stay free of Node globals, `Date.now()`, `crypto.*`, async, and dynamic imports — they're SPA-importable, so non-pure code would leak into the browser bundle.

## Definition of done on a PR

All of these must pass locally before merge. Most run automatically via `lefthook` hooks when you commit/push; CI re-runs them as a safety net.

1. `pnpm install --resolution-only`
2. `pnpm biome check .`
3. `pnpm typecheck`
4. `pnpm check:arch`
5. `pnpm check:knip`
6. `pnpm check:types:boundaries`
7. `pnpm check:conventions`
8. `pnpm check:env-example`
9. `pnpm db:check-auth`
10. `pnpm test`
11. `pnpm test:integration`
12. `pnpm audit --audit-level=high`

`pnpm check` runs all of the above in one pass.

Additional:
- If you touched `packages/db/src/**`, run `pnpm db:generate` and commit the new migration.
- If you added or changed a route in `packages/api`, the `hc` client types round-trip into `apps/web`.
- If you added a dependency, pin it appropriately (critical pins are gated in `renovate.json`).

## Where to start

- New domain concept → `packages/domain/src/<aggregate>/`, then add a port in `packages/ports/`, then a use case in `packages/core/`.
- New API endpoint → `packages/api/src/routes/<namespace>.ts`, mount under `/api/v1/*` (Better Auth lives at `/api/auth/*`).
- New SPA screen → `apps/web/src/routes/<path>.tsx` (TanStack Router file-based).
- New D1 table → `packages/db/src/schema/<aggregate>.ts`, export from `packages/db/src/schema.ts` barrel, relations in `packages/db/src/relations.ts`.

## Non-negotiable conventions (enforced by checks)

- Deploy path: `wrangler versions upload` then `wrangler versions deploy --yes`. `wrangler deploy` is banned — versioned deploys give atomic traffic flips and one-command rollback.
- Drizzle introspect/pull is banned — schema is hand-split and these tools thrash the layout.
- `drizzle.config.ts` must point at the barrel `./src/schema.ts`, not a glob (glob + barrel causes drizzle-kit duplicate-table failures).
- Cross-package imports use `workspace:*` + `package.json#exports` pointing at `./src/*.ts`. No `tsconfig.paths`, no `composite: true`.
- Internal planning docs are deliberately kept outside this repo. Do not add cross-references (relative paths pointing out of the repo, or mentions of maintainer-only doc filenames) in any committed file. `pnpm check:conventions` enforces this.
- Before bumping a pinned tool (TypeScript, wrangler, better-auth, drizzle, `@cloudflare/vitest-pool-workers`, etc.) or proposing a stack change, consult `docs/tripwires.md` — it catalogues reassess-when-X triggers tied to each pin. If an entry is relevant, follow its "Action" step rather than treating the bump as routine.

## When each check runs

| Check | IDE on save | Pre-commit (lefthook) | Pre-push (lefthook) | CI (GitHub Actions) |
|---|---|---|---|---|
| `pnpm install --resolution-only` | — | — | ✓ | (part of `pnpm install --frozen-lockfile`) |
| Biome lint + format | ✓ | staged files only | — | all files |
| `pnpm typecheck` | ✓ (via tsc server) | changed packages only | — | all packages |
| `pnpm check:types:boundaries` | — | — | — | ✓ |
| `pnpm check:arch` | — | — | ✓ | ✓ |
| `pnpm check:knip` | — | — | ✓ | ✓ |
| `pnpm check:conventions` | — | — | ✓ | ✓ |
| `pnpm check:env-example` | — | when `.dev.vars.example` changes | — | ✓ |
| `pnpm db:check-auth` | — | — | ✓ | ✓ |
| `pnpm test` | — | — | changed packages only | all packages |
| `pnpm test:integration` | — | — | ✓ | ✓ |
| Policy-purity test | — | — | when policy/visibility changes | (part of `pnpm test`) |
| `pnpm audit --audit-level=high` | — | — | ✓ | daily + per-PR |
| TruffleHog secrets scan | — | staged files only | — | daily + per-PR |

`pnpm check` runs the superset locally; use it before opening a PR.

## Scaffolding-temporary exceptions

These exist because the scaffold is skeletal. **Remove each when its trigger fires.**

| Exception | Location | Trigger to remove |
|---|---|---|
| `vitest run --passWithNoTests` in `test` scripts | `@hearth/web` (all other packages now run real tests) | the package gets its first test |
| `knip.ignoreDependencies` for v1-expected-but-unused deps (`react-dom`, `tailwindcss`, `@cloudflare/vitest-pool-workers`, `@types/react-dom`, `@hono-rate-limiter/cloudflare`, `@sentry/cloudflare`, `@hookform/resolvers`, `react-hook-form`, `@tanstack/react-query-devtools`, `@tanstack/router-devtools`) | `knip.jsonc` | the first real import of each dep — remove that dep's entry |
| Skeleton stubs throwing `"Not implemented"` in repository adapters | `packages/adapters/cloudflare/src/*-repository.ts` (study-group, learning-track, library-item, learning-activity, activity-record, study-session; plus `user.deleteIdentity`, R2 `getDownloadUrl`) | the first use case calling that method |

New exceptions should be added to this table and the maintainer should be told before merging.
