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
3. `pnpm check:md` (dprint markdown formatting)
4. `pnpm typecheck`
5. `pnpm check:arch`
6. `pnpm check:knip`
7. `pnpm check:types:boundaries`
8. `pnpm check:conventions`
9. `pnpm check:env-example`
10. `pnpm db:check-auth`
11. `pnpm test`
12. `pnpm test:integration`
13. `pnpm check:coverage`
14. `pnpm audit --audit-level=high`

`pnpm check` runs all of the above in one pass.

`pnpm e2e` runs the Playwright suite against a locally-spawned worker + Vite dev server. It is intentionally _not_ part of the `pnpm check` aggregate (it boots two long-lived servers and downloads ~150 MB of Chromium on a fresh runner); CI invokes it as a separate workflow gate. First-time setup: `pnpm --filter @hearth/web e2e:install`.

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
- Internal planning docs are deliberately kept outside this repo. Do not add cross-references (relative paths pointing out of the repo, or mentions of maintainer-only doc filenames) in any committed file. `pnpm check:conventions` enforces this structurally — every `.md`/`.mdx` filename mentioned in committed text must resolve to a file actually committed to the repo (allowlist regenerates from `git ls-files` on every run, so committing a new doc automatically authorizes references to it; uncommitted docs are flagged with no per-name maintenance).
- Before bumping a pinned tool (TypeScript, wrangler, better-auth, drizzle, `@cloudflare/vitest-pool-workers`, etc.) or proposing a stack change, consult `docs/tripwires.md` — it catalogues reassess-when-X triggers tied to each pin. If an entry is relevant, follow its "Action" step rather than treating the bump as routine.
- Cloudflare D1 local (Miniflare-backed SQLite) is strongly consistent and synchronous. Remote D1 is async-replicated across regions and a read replica may be arbitrarily out of date relative to the primary. **Never rely on read-your-own-writes within a short window for flow-critical data.** Ephemeral auth state (OAuth state, CSRF nonces, one-shot verifications, session-token handshakes) belongs in cookies or KV, not D1. Local integration tests cannot reproduce this class of bug — only deployed-remote testing can. If a change involves a D1 write immediately followed by a read in a different request, call it out and pick a non-D1 store for the short-lived side.
- Cloudflare Workers Static Assets with `not_found_handling: "single-page-application"` + `compatibility_date >= 2025-04-01` implicitly activates `assets_navigation_prefers_asset_serving`. Any browser request carrying `Sec-Fetch-Mode: navigate` that doesn't match a static asset is served the SPA's `index.html` — **the Worker is never invoked**. This silently breaks OAuth callbacks, Stripe webhooks visited via browser, magic-link landing URLs, and any other API route expected to be reachable via top-level navigation. The `assets.run_worker_first` array form (e.g. `["/api/*", "/healthz"]`) explicitly opts those paths out of SPA fallback and is CF's documented fix for this exact case. Local `wrangler dev` does not reproduce this without the real edge routing; only deployed-remote testing catches it. Never add an API route under a path pattern outside `run_worker_first` without verifying it's either XHR-only or gated behind the array.
- **Record fix-later debt where it can be found again.** When a review surfaces an issue that is correct _for now_ but must change later (a hardcoded value tied to a v1 assumption, a deferred feature gate, an explicit "we'll revisit when X ships"), write it down before the session closes. Pick the right surface: a `TODO(scope-hint):` at the call site for code-local debt that a `grep` will surface; a `docs/tripwires.md` entry for stack-level debt with an upstream trigger; a GitHub issue for milestone-shaped work. Lampshading an issue in conversation and moving on is forbidden — the next session has no memory of it. If you cannot decide where it belongs, default to `docs/tripwires.md` and note the trigger condition explicitly.
- **Conditional UPDATE on every status-guarded mutation.** D1 is single-threaded per query but inter-statement gaps allow concurrent requests' SELECT-then-UPDATE sequences to interleave. Any adapter mutation that reads a row, validates a status invariant (`status === "active"`, `deactivatedAt === null`, etc.), then issues an UPDATE must include the same invariant in the UPDATE's WHERE clause and `.returning()` the affected ids — if `length === 0`, throw `DomainError("CONFLICT", …, "<state>_changed")`. Without this, a concurrent state-flip lands metadata writes on a now-frozen row. The canonical pattern is in `packages/adapters/cloudflare/src/study-group-repository.ts` `updateMetadata`. Every aggregate with a frozen-state invariant (groups: `archived`; tracks: `paused`/`archived`; users: `deactivated`; activities: `closed`/`archived`) needs at least one concurrent-mutation integration test exercising the race — `Promise.allSettled([archive, updateMetadata])`, assert one of the two resolves CONFLICT and the row never ends in a corrupted state.
- **Mobile overflow at 375px.** Buttons must not wrap their label across lines — the shared `Button` primitive sets `whitespace-nowrap` for that reason. When a section header puts a `<p>` next to a `<Button>`, give the paragraph `min-w-0 flex-1` so it shrinks before the button collapses; or stack the row with `flex-col sm:flex-row`. The `mobile-overflow.spec.ts` e2e guards this at 375px across home, group home, dialogs, drawer, and admin tabs — when adding a new screen with interactive controls, extend that spec rather than relying on visual-only review.
- **Viewability before authorization on mutation routes.** A mutation or read use case for a hideable resource (anything with `canViewGroup`-shaped visibility) MUST run the viewability check first and surface its denial as `DomainError("NOT_FOUND", …)`, then run the role/permission check. The shape: `viewability → 404` (hides existence), then `authorization → 403` (acknowledges existence to authorized viewers). Skipping viewability leaks group/track/etc. existence to non-members via the 403-vs-404 status-code distinction — the enumeration oracle pattern flagged on PR #8. **Use `loadViewableGroup`** (`packages/core/src/use-cases/_lib/load-viewable-group.ts`) as the only entry point for loading a hideable group in a use case; it bundles `byId` + `membership` + `getOperator` + `canViewGroup` into one call, throws `NOT_FOUND` on view denial, and is enforced by the `no-direct-group-byid-in-use-cases` convention check. Canonical example: `packages/core/src/use-cases/archive-group.ts`.
- **Terminal UI actions require type-to-confirm friction.** Irreversible actions (track archive, hard-delete, account closure) MUST gate the confirm button on a typed phrase via `ConfirmActionDialog`'s `confirmationPhrase` prop — Cloudscape and PatternFly converge on this pattern. Reversible actions (group archive→unarchive, role demote, soft-delete) keep the basic Cancel/Confirm; heavier friction belongs on the irreversible side. The asymmetry of friction must track the asymmetry of consequence — sharing the same dialog shape across both invites muscle-memory mistakes.
- **Authorization policies are authority-only by default; encode aggregate state ONLY when the action has no idempotent interpretation.** `canArchive*` stays authority-only because re-archiving is a no-op (the use case short-circuits and returns the existing row); the policy answers "may you attempt this," idempotence lives in the use case. `canPauseTrack` / `canResumeTrack` DO deny on archived because pause/resume on archived has no idempotent shape — the operation is logically invalid, so the policy denies upfront and `caps.canPause/Resume` stays honest for SPA gating. Decision rule: idempotent action ⇒ authority-only policy; non-idempotent action ⇒ policy denies on the impossible state.

## Authoring discipline

- **Default to no comments. When you do write one, make it self-contained.** Add a comment only when the WHY is non-obvious (a hidden constraint, a workaround for a specific bug, behavior that would surprise a reader); never narrate WHAT — well-named identifiers do that. Comments must read as standalone context for a future reader, not as a reply to a PR review, prior conversation, or earlier version of the code: never define the code by what it _isn't_, _used to be_, or _doesn't need_ ("no external X doc," "we don't have a Y," "without needing a Z," "no longer uses Q," "moved from A to B," "instead of citing R" all rot the moment the prior conversation ages out). If a comment only makes sense to someone who saw the previous version, rewrite it.
- **Never add TODO comments unless the user asks.** Finish or delete; don't narrate.
- **Existing `TODO(...)` comments are load-bearing.** Do NOT remove a TODO, rename it, or rewrite the comment to lose its `TODO(` prefix unless you actually completed the work or the user confirmed it's obsolete. A "cosmetic" rewrite that loses `TODO(` disappears from `grep` / PR sweeps and from the § Scaffolding-temporary exceptions table — that's a regression in tracking, not a cleanup. When in doubt, ask.
- **Don't bypass hooks.** Lefthook's pre-commit and pre-push run the DoD gates; if you bypass them you must run the gates manually. Checks that sit and rot are worse than no checks — if a check is ever noise you can't fix, remove the check or fix the code. Do not silently `|| true` past it.
- **Convention carve-outs require explicit maintainer permission.** When a check fires (`check:conventions`, biome rule, dep-cruiser rule, jscpd, knip, etc.), the default move is to satisfy the rule's intent structurally — never to widen the exception list by analogy. Adding an entry to a rule's exclude list / `// biome-ignore` / `// eslint-disable` / `@ts-expect-error` / `// jscpd:ignore-*` / `passWithNoTests` requires explicit human approval. Existing carve-outs are NOT precedent for new ones — each is load-bearing for a specific reason that does not generalize. Before reaching for an exemption: (1) name the rule's intent in plain language, (2) ask whether the violating code can be restructured to satisfy that intent, (3) only then surface the exemption proposal to the maintainer with a justification. "There's already a carve-out for X, so adding one for Y is fine" is not a justification.

## Research before writing

- Before adding a dependency, check it's in the catalog (`pnpm-workspace.yaml`). If yes, use `"catalog:"` as the version.
- Before adding a route, skim `packages/api/src/routes/` to match the existing pattern.
- Before adding a policy predicate, skim `packages/domain/src/policy/` — its files must stay pure (no async, no `Date.now()`, no `crypto`, no Node globals).

## Local dev auth — use `pnpm local-session`

Whenever a task needs an authenticated session against the local stack (driving a Playwright script, hitting the worker via curl, running a design review), use `scripts/local-session.mjs` instead of re-deriving the Better Auth HMAC dance. The script is the canonical seam — a cookie minted by it is byte-identical to one minted by an e2e test or a real OAuth sign-in (modulo the user-id prefix).

```sh
# Defaults: seed-operator@local.dev, "Local Operator", instance operator.
pnpm local-session --seed                           # human-readable hint
pnpm -s local-session --seed --cookie-only          # just the cookie value
pnpm local-session --seed --json                    # machine-readable
pnpm local-session --reset --seed                   # drop user's groups+sessions, re-seed
pnpm local-session --email me@x.com --seed          # different identity
```

Three things to know:

1. **`--seed` is idempotent.** It uses `INSERT OR IGNORE`, so re-running never errors and never bumps `granted_at`. Pass it freely.
2. **`--reset` scrubs only the named user's state** (sessions, group memberships, tracks/enrollments orphaned by the membership delete, and groups whose only member was that user). It will not touch other users — safe to use against the dev DB you're signed into via OAuth.
3. **`pnpm` is cwd-sensitive.** Running `pnpm local-session` from `apps/web/` fails because the script lives in the root `package.json`. Run from the repo root, or have your script `spawnSync` with `cwd: REPO_ROOT`.

Implementation lives at `scripts/lib/auth-session.mjs` (shared module, JSDoc-typed via `auth-session.d.mts`); `apps/web/e2e/auth.ts` and `scripts/local-session.mjs` both import from it. Do not re-implement HMAC signing or session-row inserts in a third place — extend that module instead.

## When each check runs

| Check                            | IDE on save        | Pre-commit (lefthook)            | Pre-push (lefthook)             | CI (GitHub Actions)                        |
| -------------------------------- | ------------------ | -------------------------------- | ------------------------------- | ------------------------------------------ |
| `pnpm install --resolution-only` | —                  | —                                | ✓                               | (part of `pnpm install --frozen-lockfile`) |
| Biome lint + format              | ✓                  | staged files only                | —                               | all files                                  |
| dprint markdown format           | —                  | staged files only                | full repo (belt-and-suspenders) | ✓                                          |
| `pnpm typecheck`                 | ✓ (via tsc server) | changed packages only            | —                               | all packages                               |
| `pnpm check:types:boundaries`    | —                  | —                                | —                               | ✓                                          |
| `pnpm check:arch`                | —                  | —                                | ✓                               | ✓                                          |
| `pnpm check:knip`                | —                  | —                                | ✓                               | ✓                                          |
| `pnpm check:conventions`         | —                  | —                                | ✓                               | ✓                                          |
| `pnpm check:dup`                 | —                  | —                                | ✓                               | ✓                                          |
| `pnpm check:env-example`         | —                  | when `.dev.vars.example` changes | —                               | ✓                                          |
| `pnpm db:check-auth`             | —                  | —                                | ✓                               | ✓                                          |
| `pnpm test`                      | —                  | —                                | changed packages only           | all packages                               |
| `pnpm test:integration`          | —                  | —                                | ✓                               | ✓                                          |
| `pnpm check:coverage`            | —                  | —                                | ✓                               | ✓                                          |
| Policy-purity test               | —                  | —                                | when policy/visibility changes  | (part of `pnpm test`)                      |
| `pnpm audit --audit-level=high`  | —                  | —                                | ✓                               | daily + per-PR                             |
| TruffleHog secrets scan          | —                  | staged files only                | —                               | daily + per-PR                             |

`pnpm check` runs the superset locally; use it before opening a PR.

## Scaffolding-temporary exceptions

These exist because the scaffold is skeletal. **Remove each when its trigger fires.**

| Exception                                                                                                                                                                                                  | Location                                                                                                                           | Trigger to remove                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `vitest run --passWithNoTests` in `test` scripts                                                                                                                                                           | `@hearth/web` (all other packages now run real tests)                                                                              | the package gets its first test                             |
| `knip.ignoreDependencies` for v1-expected-but-unused deps (`react-dom`, `tailwindcss`, `@types/react-dom`, `@hono-rate-limiter/cloudflare`, `@tanstack/react-query-devtools`, `@tanstack/router-devtools`) | `knip.jsonc`                                                                                                                       | the first real import of each dep — remove that dep's entry |
| Skeleton stubs throwing `"Not implemented"` in repository adapters                                                                                                                                         | `packages/adapters/cloudflare/src/*-repository.ts` (learning-activity, activity-record, study-session; plus `user.deleteIdentity`) | the first use case calling that method                      |

New exceptions should be added to this table and the maintainer should be told before merging.
