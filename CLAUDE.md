# Claude-specific notes

Inherits `AGENTS.md`. Claude-only conventions below.

## Before every commit

Run `pnpm check` (aggregate script) or at minimum the individual gates listed in `AGENTS.md` § "Definition of done on a PR". Lefthook's pre-commit + pre-push run these automatically; if you bypass hooks you must run them manually. Checks that sit and rot are worse than no checks — if a check is ever noise you can't fix, remove the check or fix the code. Do not silently `|| true` past it.

## Editing

- Prefer `Edit` over `Write` for existing files. Only `Write` for genuinely new files.
- Never add TODO comments unless the user asks. Finish or delete; don't narrate.
- Default to no comments in generated code. Only add a comment when the WHY is non-obvious.

## Research before writing

- Before adding a dependency, check it's in the catalog (`pnpm-workspace.yaml`). If yes, use `"catalog:"` as the version.
- Before adding a route, skim `packages/api/src/routes/` to match the existing pattern.
- Before adding a policy predicate, skim `packages/domain/src/policy/` — its files must stay pure (no async, no `Date.now()`, no `crypto`, no Node globals).

## Skills worth using

- Run `/code-review` before merging a non-trivial PR.
- Run `/security-review` before merging a PR that touches auth, permissions, or data access.

## Never in committed code

- Don't reference internal planning docs (e.g., paths under `docs/` that don't exist in this repo). Explain the "why" directly in the comment instead.
- Don't run `wrangler deploy`. Canonical path is `wrangler versions upload` then `wrangler versions deploy --yes`.
- Don't run `drizzle-kit introspect` or `drizzle-kit pull`. The schema is hand-split; these tools thrash the layout.
- Don't point `drizzle.config.ts` at a schema glob — use the barrel `./src/schema.ts`. Glob + barrel causes drizzle-kit duplicate-table failures.
- Don't add `tsconfig.paths` for cross-package imports. Use `workspace:*` + `package.json#exports`.

## If a check fails

Ask the user before adding an exception (ignore list, `passWithNoTests`, `eslint-disable`, etc.). The preference is to fix the code or remove the check, not to paper over it. If an exception is genuinely warranted, comment why and (if temporary) add a TODO with a clear removal trigger.
