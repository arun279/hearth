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
packages/domain   → leaf; zod (the one runtime dep, used by `parts/` + `activity/` schemas)
packages/ports    → packages/domain  (pure interfaces)
```

These rules are enforced by `pnpm check:arch` (dependency-cruiser) in CI. Files under `packages/domain/src/policy/**` and `packages/domain/src/visibility/**` must additionally stay free of Node globals, `Date.now()`, `crypto.*`, async, and dynamic imports — they're SPA-importable, so non-pure code would leak into the browser bundle.

## Definition of done on a PR

All of these must pass locally before merge. Most run automatically via `lefthook` hooks when you commit/push; CI re-runs them as a safety net.

1. `pnpm install --resolution-only`
2. `pnpm biome check .`
3. `pnpm check:md` (dprint markdown formatting)
4. `pnpm check:typos` (crate-ci/typos spell-check, via a pinned local binary)
5. `pnpm typecheck`
6. `pnpm check:arch`
7. `pnpm check:knip`
8. `pnpm check:types:boundaries`
9. `pnpm check:conventions`
10. `pnpm check:env-example`
11. `pnpm db:check-auth`
12. `pnpm test`
13. `pnpm test:integration`
14. `pnpm check:coverage`
15. `pnpm check:licenses`
16. `pnpm audit --audit-level=high`

`pnpm check` runs all of the above in one pass.

`pnpm e2e` runs the Playwright suite against a locally-spawned worker + Vite dev server. It is intentionally _not_ part of the `pnpm check` aggregate (it boots two long-lived servers and downloads ~150 MB of Chromium on a fresh runner); CI invokes it as a separate workflow gate. First-time setup: `pnpm --filter @hearth/web e2e:install`.

Additional:

- If you touched `packages/db/src/**`, run `pnpm db:generate` and commit the new migration.
- If you added or changed a route in `packages/api`, the `hc` client types round-trip into `apps/web`.
- If you added a dependency, pin it appropriately (critical pins are gated in `renovate.json`).

## Where to start

- New domain concept → `packages/domain/src/<aggregate>/`, then add a port in `packages/ports/`, then a use case in `packages/core/`.
- New API endpoint → `packages/api/src/routes/<namespace>.ts`, mount under `/api/v1/*` (Better Auth lives at `/api/auth/*`).
- New SPA screen → `apps/web/src/routes/<path>.tsx` (TanStack Router file-based); compose `<PageContainer>` for the content measure.
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
- **Record fix-later debt where it can be found again, in the SAME response that announces the deferral.** When a review surfaces an issue that is correct _for now_ but must change later (a hardcoded value tied to a v1 assumption, a deferred feature gate, an explicit "we'll revisit when X ships"), the response that says "deferred" / "punt" / "not fixing" / "future work" MUST contain the `Edit` (or `gh issue create`) that records it — not "later in the session," not "before the summary." Batching invites forgetting; "I'll come back to it" turns into a summary that asserts coverage that doesn't exist. Pick the right surface: a `TODO(mN):` tagged with the owning milestone at the call site for code-local debt that a `grep` will surface; a `docs/tripwires.md` entry for stack-level debt with an upstream trigger; a GitHub issue for milestone-shaped work. Lampshading an issue in conversation and moving on is forbidden — the next session has no memory of it. If you cannot decide where it belongs, default to `docs/tripwires.md` and note the trigger condition explicitly.
- **Defer only when the deferral has a real reason.** A finding may be deferred to a future milestone ONLY if (a) it depends on a feature that does not yet exist in the codebase, OR (b) it is genuinely better suited to a later milestone that is already defined in the project's milestone list — never to a hallucinated milestone, never because "polish-tier" reads as low-effort. Otherwise: do it now. The default for any open finding is "fix it in this PR." The bar to defer is "name the missing dependency or the already-defined milestone home." If you can't, the finding goes in the current PR's scope.
- **Conditional UPDATE on every status-guarded mutation.** D1 is single-threaded per query but inter-statement gaps allow concurrent requests' SELECT-then-UPDATE sequences to interleave. Any adapter mutation that reads a row, validates a status invariant (`status === "active"`, `deactivatedAt === null`, etc.), then issues an UPDATE must include the same invariant in the UPDATE's WHERE clause and `.returning()` the affected ids — if `length === 0`, throw `DomainError("CONFLICT", …, "<state>_changed")`. Without this, a concurrent state-flip lands metadata writes on a now-frozen row. The canonical pattern is in `packages/adapters/cloudflare/src/study-group-repository.ts` `updateMetadata`. Every aggregate with a frozen-state invariant (groups: `archived`; tracks: `paused`/`archived`; users: `deactivated`; activities: `closed`/`archived`) needs at least one concurrent-mutation integration test exercising the race — `Promise.allSettled([archive, updateMetadata])`, assert one of the two resolves CONFLICT and the row never ends in a corrupted state.
- **Mobile overflow at 375px.** Buttons must not wrap their label across lines — the shared `Button` primitive sets `whitespace-nowrap` for that reason. When a section header puts a `<p>` next to a `<Button>`, give the paragraph `min-w-0 flex-1` so it shrinks before the button collapses; or stack the row with `flex-col sm:flex-row`. The `mobile-overflow.spec.ts` e2e guards this at 375px across home, group home, dialogs, drawer, and admin tabs — when adding a new screen with interactive controls, extend that spec rather than relying on visual-only review.
- **Viewability before authorization on mutation routes.** A mutation or read use case for a hideable resource (anything with `canViewGroup`-shaped visibility) MUST run the viewability check first and surface its denial as `DomainError("NOT_FOUND", …)`, then run the role/permission check. The shape: `viewability → 404` (hides existence), then `authorization → 403` (acknowledges existence to authorized viewers). Skipping viewability leaks group/track/etc. existence to non-members via the 403-vs-404 status-code distinction — the enumeration oracle pattern flagged on PR #8. **Use `loadViewableGroup`** (`packages/core/src/use-cases/_lib/load-viewable-group.ts`) as the only entry point for loading a hideable group in a use case; it bundles `byId` + `membership` + `getOperator` + `canViewGroup` into one call, throws `NOT_FOUND` on view denial, and is enforced by the `no-direct-group-byid-in-use-cases` convention check. Canonical example: `packages/core/src/use-cases/archive-group.ts`.
- **Terminal UI actions require type-to-confirm friction.** Irreversible actions (track archive, hard-delete, account closure) MUST gate the confirm button on a typed phrase via `ConfirmActionDialog`'s `confirmationPhrase` prop — Cloudscape and PatternFly converge on this pattern. Reversible actions (group archive→unarchive, role demote, soft-delete) keep the basic Cancel/Confirm; heavier friction belongs on the irreversible side. The asymmetry of friction must track the asymmetry of consequence — sharing the same dialog shape across both invites muscle-memory mistakes.
- **Authorization policies are authority-only by default; encode aggregate state ONLY when the action has no idempotent interpretation.** `canArchive*` stays authority-only because re-archiving is a no-op (the use case short-circuits and returns the existing row); the policy answers "may you attempt this," idempotence lives in the use case. `canPauseTrack` / `canResumeTrack` DO deny on archived because pause/resume on archived has no idempotent shape — the operation is logically invalid, so the policy denies upfront and `caps.canPause/Resume` stays honest for SPA gating. Decision rule: idempotent action ⇒ authority-only policy; non-idempotent action ⇒ policy denies on the impossible state.
- **`useQuery.isError` must always be read.** Every `useQuery` call site MUST surface `query.isError` as a distinct branch — typically a `<Callout tone="danger">` with a "Try again" `query.refetch()` button. Without it, server failures silently collapse to the empty state ("there's nothing here" instead of "we couldn't reach the server, retry"), and the SPA lies to the user. The library-search and Activities-tab regressions both produced exactly this anti-pattern; the canonical pattern is in `apps/web/src/routes/g.$groupId_.library.tsx` (`searchError` branch). When wiring a new query-driven surface, render the loading / error / empty / data branches in that order — leave none implicit.
- **When a query target can 404, the `isError` branch MUST split on `errorStatus(err)`.** A single "Couldn't load X — Try again" surface for both 404 (the resource doesn't exist / viewer not in audience / post-close hidden) and 5xx (transient backend) lies to the user in opposite directions: retry on the 404 case loops forever; a danger-toned "broken" message on the 404 case suggests an outage when the link is just stale. Use `errorStatus(err)` from `apps/web/src/lib/problem.ts` to branch: on 404 render a neutral-toned "isn't available" surface with a navigation-style recovery affordance (back to parent) and no retry button; on 5xx keep the danger Callout + retry. The canonical pattern is in `apps/web/src/components/activities/player/activity-player.tsx` (`ErrorState`). This rule applies whenever the route can legitimately return 404 — list endpoints that always return 200 with `[]` keep the simple isError branch.
- **Disabled primary CTAs are an anti-pattern; prefer enabled-CTA + on-submit inline errors.** A silently-disabled "Save" / "Create" / "Submit" button gives the user no signal about which field is gating the action — first-time users read it as "the system is broken." When a form has required fields, render the primary CTA enabled and let the submit handler set a specific inline error naming the gating field. Pair with a visible "required" mark on the gating field via `<Field required>`. The disabled pattern is appropriate ONLY for in-flight states (`disabled={submitting}`) and for genuine no-op cases where the next state would be identical to the current (e.g., a Save button on a pristine form). The composer in `apps/web/src/components/activities/activity-composer.tsx` is the canonical reference.
- **Authoring dialogs MUST confirm-on-discard when dirty.** Any dialog that takes more than 30 seconds of user input (composer, upload, multi-field settings) MUST intercept Esc / overlay-click / Cancel and show a confirm prompt when the in-flight draft has diverged from the initial seed. Pristine dialogs still close instantly so friction stays proportional to consequence. The dirty-check shape is in `apps/web/src/components/activities/activity-composer.tsx` (`serializeDraftForDirtyCheck` + `discardConfirmOpen`). Trivial dialogs (single-field rename, type-to-confirm dialogs) skip the gate.
- **e2e teardown FK ordering: scope by activity_id (not library_item_id) when cascading from activities into refs.** When extending `apps/web/e2e/auth.ts` `resetInstanceState()` with a new e2e cascade that touches `activity_library_refs`, the delete MUST be scoped by `activity_id IN (orphan-activity-ids)`, not by `library_item_id IN (e2e-uploaded-items)`. The latter leaves orphan refs whenever an e2e activity attaches to a non-e2e (developer-uploaded) library item, and the next `DELETE FROM learning_activities` trips FK RESTRICT. The activity-side cascade is the primary cleanup; the library-side scoped delete catches the inverse case (non-e2e activities pointing at e2e-uploaded items so the items themselves can be dropped). The canonical shape is the M8 block in `apps/web/e2e/auth.ts`.
- **Every test file is type-checked; tests are routed by config, never per-file.** Plain tests live flat under a package's `test/` and are typed by its main `tsconfig.json` via a recursive `test/**/*.ts` (`.tsx` for `packages/ui`) include — no separate test config. Workers-runtime tests live under `packages/adapters/cloudflare/test/integration/**` and are typed by a sibling `tsconfig.integration.json` (it pins `@cloudflare/vitest-pool-workers/types` for the `cloudflare:test` module) chained off the main one with `tsc --noEmit && tsc --noEmit -p tsconfig.integration.json`; the main config stops at `test/*.test.ts` (single level) so it never sees the Workers-runtime sources. A new test kind adds one sibling `tsconfig.<kind>.json` chained the same way — never a per-file include or exclude. The same routing-by-config rule covers the test environment: stateful DOM component tests are named `*.dom.test.tsx` and routed to a happy-dom vitest project (the `dom` project in `apps/web/vitest.config.ts` / `packages/ui/vitest.config.ts`), while pure/SSR-string tests stay on the node `unit` project — never a `// @vitest-environment` docblock. Both projects run inside a single `vitest run`, so DOM tests ride the existing `pnpm test` gate; there is no separate command.

## Authoring discipline

- **Test at the right altitude; new interactive components ship with a DOM test for their stateful branches.** Pick the cheapest layer that can actually express the behaviour:
  - **Pure logic / formatting / reducers** → plain unit test on the node environment.
  - **Static render / a11y attributes / SSR-safety** → `renderToString` / `renderToStaticMarkup` SSR-string test (node) — good for markup contracts, can't drive a transition.
  - **Stateful DOM behaviour** (user events, async transitions, focus, fetch-driven state, timers/debounce, visibility/unmount effects) → a `*.dom.test.tsx` component test on happy-dom, mounting the real component via `apps/web/src/test/render.tsx` (`renderWithProviders` + `installFetchSpy`) or `packages/ui/src/test/render.tsx` (`renderPrimitive`).
  - **End-to-end journeys across routes + real backend** → Playwright e2e. Don't re-pin happy-path journeys in the DOM layer; target the interaction branches e2e can't economically reach (race windows, no-op skips, error→retry transitions).
- **Default to no comments. When you do write one, make it self-contained.** Add a comment only when the WHY is non-obvious (a hidden constraint, a workaround for a specific bug, behavior that would surprise a reader); never narrate WHAT — well-named identifiers do that. Comments must read as standalone context for a future reader, not as a reply to a PR review, prior conversation, or earlier version of the code: never define the code by what it _isn't_, _used to be_, or _doesn't need_ ("no external X doc," "we don't have a Y," "without needing a Z," "no longer uses Q," "moved from A to B," "instead of citing R" all rot the moment the prior conversation ages out). If a comment only makes sense to someone who saw the previous version, rewrite it.
- **Disabled-state styling lives on the primitive, not the call site.** An interactive primitive's disabled affordance (`disabled:opacity-*`, `disabled:pointer-events-none`, etc.) belongs in its base classes — never patched per-`className` at each call site. If a shared primitive lacks a disabled affordance, fix the primitive (`Button` / `IconButton` are the reference); per-site patches drift and miss sites.
- **`aria-haspopup` takes only `menu` / `listbox` / `tree` / `grid` / `dialog`, and the popup's role must match.** A disclosure (a panel that just shows/hides content, not one of those six roles) uses `aria-expanded` + `aria-controls`, not `aria-haspopup`.
- **Don't ship an optional UI prop ahead of a real consumer.** Add a component prop when the second variant that needs it actually exists; knip can't see unused pass-through props on internal components, so a speculative one rots silently.
- **Never add TODO comments unless the user asks; scope each to a single owning milestone.** Finish or delete; don't narrate. Every `TODO(` must read `TODO(mN)` (e.g. `TODO(m11)`, `TODO(m10.5)`); non-milestone scopes, ranges, and bare `TODO` are rejected by `check:conventions` (`no-unscoped-todo`). Debt with no owning milestone belongs in a prose note plus `docs/tripwires.md` / the `§ Scaffolding-temporary` table, not a `TODO(`.
- **Existing `TODO(...)` comments are load-bearing.** Do NOT remove a TODO, rename it, or rewrite the comment to lose its `TODO(` prefix unless you actually completed the work or the user confirmed it's obsolete. A "cosmetic" rewrite that loses `TODO(` disappears from `grep` / PR sweeps and from the § Scaffolding-temporary exceptions table — that's a regression in tracking, not a cleanup. When in doubt, ask.
- **Don't bypass hooks.** Lefthook's pre-commit and pre-push run the DoD gates; if you bypass them you must run the gates manually. Checks that sit and rot are worse than no checks — if a check is ever noise you can't fix, remove the check or fix the code. Do not silently `|| true` past it.
- **Never amend, force-push, or rewrite history without explicit maintainer approval.** `git commit --amend` and `git push --force` (including `--force-with-lease`, `-f`) are blocked by lefthook hooks (`prepare-commit-msg` and `pre-push` respectively). The `HEARTH_ALLOW_AMEND` and `HEARTH_ALLOW_FORCE_PUSH` env vars exist for the rare legitimate case (typo in an unpushed local commit you just made; force-push to your own feature branch with no reviewers) — same shape as `--no-verify`. Agents MUST NOT use these overrides without an explicit maintainer ask. The principle: **the diff your reviewer saw stays the diff your reviewer saw.** Fixes after a review go in a NEW commit on top with a commit message naming what changed and why; the reviewed commit stays untouched. The same rule extends to `git reset --hard` against pushed commits, `git rebase -i` on shared branches, and `git filter-repo` — soft rules and judgement calls don't cover these; the hooks do, and the override path is gated.
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
| `pnpm check:typos`               | —                  | staged files only                | full repo (belt-and-suspenders) | ✓                                          |
| `pnpm typecheck`                 | ✓ (via tsc server) | changed packages only            | —                               | all packages                               |
| `pnpm check:types:boundaries`    | —                  | —                                | —                               | ✓                                          |
| `pnpm check:arch`                | —                  | —                                | ✓                               | ✓                                          |
| `pnpm check:knip`                | —                  | —                                | ✓                               | ✓                                          |
| `pnpm check:conventions`         | —                  | —                                | ✓                               | ✓                                          |
| `pnpm check:dup`                 | —                  | —                                | ✓                               | ✓                                          |
| `pnpm check:env-example`         | —                  | when `.dev.vars.example` changes | —                               | ✓                                          |
| `pnpm db:check-auth`             | —                  | —                                | ✓                               | ✓                                          |
| `pnpm test` (node + happy-dom)   | —                  | —                                | changed packages only           | all packages                               |
| `pnpm test:integration`          | —                  | —                                | ✓                               | ✓                                          |
| `pnpm check:coverage`            | —                  | —                                | ✓                               | ✓                                          |
| `pnpm check:licenses`            | —                  | —                                | ✓                               | (mirrored by dep-review action)            |
| Policy-purity test               | —                  | —                                | when SPA-pure dirs change       | (part of `pnpm test`)                      |
| `pnpm audit --audit-level=high`  | —                  | —                                | ✓                               | daily + per-PR                             |
| TruffleHog secrets scan          | —                  | staged files only                | —                               | daily + per-PR                             |

`pnpm check` runs the superset locally; use it before opening a PR.

## Scaffolding-temporary exceptions

These exist because the scaffold is skeletal. **Remove each when its trigger fires.**

| Exception                                                                                                                                                                 | Location                                                                                                                         | Trigger to remove                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `knip.ignoreDependencies` for v1-expected-but-unused deps (`tailwindcss`, `@hono-rate-limiter/cloudflare`, `@tanstack/react-query-devtools`, `@tanstack/router-devtools`) | `knip.jsonc`                                                                                                                     | the first real import of each dep — remove that dep's entry     |
| Skeleton stubs throwing `"Not implemented"` in repository adapters                                                                                                        | `study-session-repository.ts` (`TODO(m13)`), `user-repository.ts` `deleteIdentity` (`TODO(m18)`), `stub.ts` helper (`TODO(m18)`) | the first use case calling that method (M13 / M18 respectively) |

New exceptions should be added to this table and the maintainer should be told before merging.
