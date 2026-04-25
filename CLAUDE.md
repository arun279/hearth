# Claude-specific notes

Inherits `AGENTS.md`. Claude-only conventions below.

## Before every commit

Run `pnpm check` (aggregate script) or at minimum the individual gates listed in `AGENTS.md` § "Definition of done on a PR". Lefthook's pre-commit + pre-push run these automatically; if you bypass hooks you must run them manually. Checks that sit and rot are worse than no checks — if a check is ever noise you can't fix, remove the check or fix the code. Do not silently `|| true` past it.

## Editing

- Prefer `Edit` over `Write` for existing files. Only `Write` for genuinely new files.
- Never add TODO comments unless the user asks. Finish or delete; don't narrate.
- Default to no comments in generated code. Only add a comment when the WHY is non-obvious.

## Existing TODOs are not decoration

- Existing `TODO(...)` comments flag work that still needs to be done. Do NOT remove a TODO, rename it, or rewrite the comment to lose its `TODO(` prefix unless you actually completed the work it describes (or the user confirmed the TODO is obsolete).
- This applies even to "cosmetic" rewrites: a comment that loses `TODO(` disappears from `grep`/PR sweeps and from the `AGENTS.md § Scaffolding-temporary exceptions` table. That's a regression in tracking, not a cleanup.
- When in doubt, ask. "Is this TODO still valid?" is cheaper than silently burying it.

## Research before writing

- Before adding a dependency, check it's in the catalog (`pnpm-workspace.yaml`). If yes, use `"catalog:"` as the version.
- Before adding a route, skim `packages/api/src/routes/` to match the existing pattern.
- Before adding a policy predicate, skim `packages/domain/src/policy/` — its files must stay pure (no async, no `Date.now()`, no `crypto`, no Node globals).

## Skills worth using

- Run `/code-review` before merging a PR to main.
- Run `/simplify` before merging a PR to main.

## Local Playwright / dev auth — use `pnpm local-session`

Whenever a task needs an authenticated session against the local stack (driving a Playwright script, hitting the worker via curl, running `/design-review`), use `scripts/local-session.mjs` instead of re-deriving the Better Auth HMAC dance. The script is the canonical seam — a cookie minted by it is byte-identical to one minted by an e2e test or a real OAuth sign-in (modulo the user-id prefix).

```sh
# Defaults: seed-operator@local.dev, "Local Operator", instance operator.
pnpm local-session --seed                           # human-readable hint
pnpm -s local-session --seed --cookie-only          # just the cookie value
pnpm local-session --seed --json                    # machine-readable
pnpm local-session --reset --seed                   # drop user's groups+sessions, re-seed
pnpm local-session --email me@x.com --seed          # different identity
```

Three things to know:

1. **`--seed` is idempotent.** It uses `INSERT OR IGNORE`, so re-running it never errors and never bumps `granted_at`. Pass it freely.
2. **`--reset` scrubs only the named user's state** (sessions, group memberships, and groups whose only member was that user). It will not touch other users — it's safe to use against the dev DB you're signed into via OAuth.
3. **`pnpm` is cwd-sensitive.** Running `pnpm local-session` from `apps/web/` fails because the script lives in the root `package.json`. Either run from the repo root, or have your script `spawnSync` with `cwd: REPO_ROOT`. `apps/web/design-review.mjs` is the reference pattern for the Playwright case.

Implementation lives at `scripts/lib/auth-session.mjs` (shared module, JSDoc-typed via `auth-session.d.mts`); `apps/web/e2e/auth.ts` and `scripts/local-session.mjs` both import from it. Do not re-implement HMAC signing or session-row inserts in a third place — extend that module instead.

## Never in committed code

- Don't reference internal planning docs (e.g., paths under `docs/` that don't exist in this repo). Explain the "why" directly in the comment instead.
- Don't run `wrangler deploy`. Canonical path is `wrangler versions upload` then `wrangler versions deploy --yes`.
- Don't run `drizzle-kit introspect` or `drizzle-kit pull`. The schema is hand-split; these tools thrash the layout.
- Don't point `drizzle.config.ts` at a schema glob — use the barrel `./src/schema.ts`. Glob + barrel causes drizzle-kit duplicate-table failures.
- Don't add `tsconfig.paths` for cross-package imports. Use `workspace:*` + `package.json#exports`.

## If a check fails

Ask the user before adding an exception (ignore list, `passWithNoTests`, `eslint-disable`, etc.). The preference is to fix the code or remove the check, not to paper over it. If an exception is genuinely warranted, comment why and (if temporary) add a TODO with a clear removal trigger.
