# Tripwires — reassess-when-X triggers

This is a short reference list of tech-stack decisions that should be reassessed when their trigger conditions fire. It's a manual checklist — no CI automation, no false-positive noise. Check quarterly, or when any of the listed upstream events lands.

Each entry names the **pinned tool**, the **condition** that triggers a reassessment, and the **action** to take. Edits to this list require a maintainer-approved change so the watch-list doesn't quietly rot.

## Language + build

### TypeScript — major-version bumps (current pin: `typescript@^5.7.2`)

- **Trigger**: TypeScript 7 ships with `tsgo` (the Go-based compiler) at GA, or any new TS major bumps the npm `latest` dist-tag.
- **Action**: run `pnpm typecheck` under the new compiler; measure CI time delta. If `tsgo` delivers meaningfully faster cold-start typechecks and our current rules all pass, file a governance issue proposing the swap. Until then, stay on `tsc`.

## Runtime + tooling

### `wrangler` — minor-version lag (current pin: `wrangler@^4.44.0`)

- **Trigger**: `wrangler@latest` on npm is two or more minor versions ahead of our pin for longer than 60 days.
- **Action**: check the intervening changelogs for D1/R2/Workers Runtime fixes we might be missing. Bump if benign; cite the specific changelog entry in the bump PR. Swap is out of scope — see master governance doc.

### `@cloudflare/workers-types` — minor-version lag (current pin: `^4.20251021.0`)

- **Trigger**: Three or more minor bumps published past our pin, or any release that removes a type we depend on.
- **Action**: bump; run `pnpm typecheck` across the monorepo. Version skew between `wrangler` and `workers-types` is a common source of subtle runtime issues — keep them within one minor of each other.

### `@cloudflare/vitest-pool-workers` — major-version bumps (current pin: `^0.14.7`)

- **Trigger**: 0.15.x (or 1.0.0) lands, or the `cloudflareTest` plugin signature changes (it removed `defineWorkersProject`/`defineWorkersConfig` in 0.14).
- **Action**: re-read the changelog, run the integration-test suite, fix any breakage in `packages/adapters/cloudflare/vitest.config.ts` in a single PR.

## Authentication + identity

### `better-auth` — ordering + adapter bugs (current pin: `^1.6.4`)

- **Trigger**: a new issue in the last 30 days at `github.com/better-auth/better-auth` concerning: `usePlural: true`, Drizzle adapter + D1, `databaseHooks.user.create.after` ordering, or `additionalFields` serialization. Also any bump past 1.6.x.
- **Action**: if the issue matches a path we exercise (admission, bootstrap-bypass, session guard, attribution fields), add a regression test and verify it passes at our pinned version. Document the test next to `packages/auth/test/admission.test.ts`.

## Database + ORM

### `drizzle-orm` / `drizzle-kit` — major or 1.0 release (current pins: `0.45.2` / `0.31.10`)

- **Trigger**: drizzle-orm 1.0.x GA, or any release that changes D1 batch semantics or adds transaction support on the `d1-http` driver.
- **Action**: evaluate whether `withTx` in `drizzle-adapter.ts` can swap from `db.batch` to `.transaction()`. If yes, migrate in a focused PR; the existing integration tests already cover atomicity guarantees.

### `drizzle-zod` — coerce-regression follow-up (current pin: `0.8.3`)

- **Trigger**: `drizzle-team/drizzle-orm#5659` closes with a fix release.
- **Action**: drop the `no-drizzle-zod-coerce` rule from `scripts/check-conventions.mjs`; reconsider whether `coerce: true` in the factory becomes safe again.

## Cloudflare platform

### R2 billing / spend caps

- **Trigger**: Cloudflare publishes a first-class "R2 spend cap" or "per-bucket hard limit" feature, or R2 adds a `Permissions -> read
  only after quota` toggle.
- **Action**: consider deprecating part of our in-app killswitch in favor of the CF-native feature. Update `docs/free-tier-guardrails.md` and re-evaluate threshold tightness.

### Budget alerts on free plan

- **Trigger**: Cloudflare makes Budget Alerts available on pure free-plan accounts (currently Pay-as-you-go only).
- **Action**: document the $0.01 threshold setup in the deployment runbook; treat the alert as the fourth line of defense behind the adapter gate, HTTP middleware, and no-card account state.

## Domain assumptions

### Hardcoded "private" admission badge

- **Trigger**: a non-`private_email_allowlist` admission policy ships (`open` or `request_to_join`). v1 fixes the policy at `private_email_allowlist`; the sidebar's `<Badge tone="warn">private</Badge>` is a true statement only as long as that holds.
- **Action**: surface the active admission policy on `MeContext.instance` (e.g. `accessPolicy: "private_email_allowlist" | "open" | "request_to_join"`) and gate the badge text + tone off it. Remove this entry once the badge is no longer hardcoded.
- **Location**: `apps/web/src/components/sidebar.tsx`.

## Test infrastructure

### V8 coverage on the Workers runtime

- **Trigger**: Vitest's coverage docs no longer list "Cloudflare Workers" as unsupported, OR `@cloudflare/vitest-pool-workers` ships a coverage binding that surfaces V8 profiler output from the workerd runtime.
- **Action**: add a `test:coverage` script + `coverage.thresholds` block to `packages/adapters/cloudflare` and to `apps/worker`. Until then, the adapter is exercised by Miniflare-backed integration tests under `test/integration/` and _does not appear_ in `pnpm check:coverage`. This is deliberate, not an oversight — the integration suite asserts behaviour against real D1 + R2 (atomic batches, idempotent updates, killswitch gating). The same applies to `apps/worker`, whose composition-root code is covered by the Playwright E2E suite.
- **Location**: `packages/adapters/cloudflare/vitest.config.ts`, `apps/worker/`.

## How to remove an entry

An entry leaves this list only when one of the following is true:

1. The trigger has fired and the action has been executed (the reassess is done; the decision stands or has moved).
2. The underlying tool is no longer in the stack.
3. A maintainer-approved governance change replaces the watched tool.

Entries accumulate slowly. If this list grows past ~10 items, reconsider whether any of them should become deterministic CI checks instead.
