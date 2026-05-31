# Tripwires — reassess-when-X triggers

This is a short reference list of tech-stack decisions that should be reassessed when their trigger conditions fire. It's a manual checklist — no CI automation, no false-positive noise. Check quarterly, or when any of the listed upstream events lands.

Each entry names the **pinned tool**, the **condition** that triggers a reassessment, and the **action** to take. Edits to this list require a maintainer-approved change so the watch-list doesn't quietly rot.

## Language + build

### TypeScript — major-version bumps (current pin: `typescript@^5.7.2`)

- **Trigger**: TypeScript 7 ships with `tsgo` (the Go-based compiler) at GA, or any new TS major bumps the npm `latest` dist-tag.
- **Action**: run `pnpm typecheck` under the new compiler; measure CI time delta. If `tsgo` delivers meaningfully faster cold-start typechecks and our current rules all pass, file a governance issue proposing the swap. Until then, stay on `tsc`.

## Runtime + tooling

### `wrangler` — minor-version lag (current pin: `wrangler@^4.86.0`)

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

## Dev-server tooling

### Vite watcher fragility on cross-package source files (current pin: `vite@^8.0.9`, ships `chokidar@3.6.0`)

- **Trigger**: Vite upgrades to chokidar 4 / 5 (re-introducing the chokidar-v4 migration that vite 6 had via PR #18453), OR Vite migrates to `@parcel/watcher` (tracking issue: vitejs/vite#12495), OR Vite ships a fix in the watcher path that adds parent-directory watches alongside `chokidar.add(file)` for cross-package source files.
- **Action**: on a long-running dev server, edit a file under `packages/*/src/` rapidly via atomic-rename (write-temp + rename — the pattern Edit tools and vim default to) and verify HMR fires every time. If it does, retire the `e2e fails locally on a long-running Vite dev server` bullet in `docs/dev-runbook.md` § 11 Troubleshooting and remove this tripwire entry. Background: with `chokidar@3.6.0`, `chokidar.add(file)` watches only the file's inode (not the parent directory); atomic-rename writes change the inode and chokidar's re-watch logic is brittle under rapid sequences. The rare-but-painful failure mode is "Vite serves the cached transform of a cross-package file from when it was first imported regardless of disk state."
- **Location**: `apps/web/vite.config.ts` (no workaround currently applied — restart fixes the immediate state, the cost of automated workarounds outweighs the rate of recurrence).

## PDF rendering

### `react-pdf` / `pdfjs-dist` are version-locked (current pins: `react-pdf@10.4.1` exact, `pdfjs-dist@5.4.296` exact)

- **Trigger**: `react-pdf` ships a new patch / minor / major bump, OR a `pdfjs-dist` advisory lands at the pinned version.
- **Action**: `react-pdf@10` bundles `pdfjs-dist@5.4.296` as a hard dep (no semver range). Bumping `react-pdf` will likely bump the bundled `pdfjs-dist`; update BOTH pins together so the workspace deduplicates to a single hoisted copy of `pdfjs-dist`. Two copies break the global `pdfjs.GlobalWorkerOptions.workerSrc` configuration silently (each copy reads its own). After bumping, re-run `pnpm --filter @hearth/web test:bundle` to confirm the lazy boundary still holds and `pnpm --filter @hearth/web dev` to confirm the Vite worker URL still resolves same-origin under the newer `pdf.worker.min.mjs` shape. Note: `pdfjs-dist >= 5.6` requires Node `>= 20.19.0 || >= 22.13.0 || >= 24`; bumping past `5.5.x` is a coupled Node-floor bump.
- **Location**: `packages/ui/package.json` (`pdfjs-dist`, `react-pdf`); `apps/web/package.json` (`pdfjs-dist` mirror for `require.resolve` in `vite.config.ts`); `packages/ui/src/parts/pdf-viewer.tsx` (worker URL + cmaps/standard_fonts URL paths); `apps/web/vite.config.ts` (pdfjs-asset copy plugin).

## Test infrastructure

### Playwright session seeding bypasses Better Auth's cookie creation

- **Trigger**: `better-auth` ships a major version (`2.x`, `3.x`, …), or the cookie format / signing scheme changes within a minor (rare, but the kind of change that lands in a "small" release without obvious fanfare).
- **Action**: re-validate `apps/web/e2e/auth.ts`'s `signSessionToken` against the upstream cookie format. Update the helper if the scheme drifted. Until then the e2e suite is not protecting us from a Better Auth cookie-format regression — a real OAuth round-trip would, but Google OAuth has no headless test mode so we mint signed cookies directly. The trade-off is acceptable; the gap is recorded so a future Better Auth bump doesn't silently drift the helper from production behaviour.
- **Location**: `apps/web/e2e/auth.ts` (`signSessionToken`, `seedOperator`).

### V8 coverage on the Workers runtime

- **Trigger**: Vitest's coverage docs no longer list "Cloudflare Workers" as unsupported, OR `@cloudflare/vitest-pool-workers` ships a coverage binding that surfaces V8 profiler output from the workerd runtime.
- **Action**: add a `test:coverage` script + `coverage.thresholds` block to `packages/adapters/cloudflare` and to `apps/worker`. Until then, the adapter is exercised by Miniflare-backed integration tests under `test/integration/` and _does not appear_ in `pnpm check:coverage`. This is deliberate, not an oversight — the integration suite asserts behaviour against real D1 + R2 (atomic batches, idempotent updates, killswitch gating). The same applies to `apps/worker`, whose composition-root code is covered by the Playwright E2E suite.
- **Location**: `packages/adapters/cloudflare/vitest.config.ts`, `apps/worker/`.

## Forms + validation

### `@hookform/resolvers` × Zod major version (current pin: `^5.2.2`, paired with Zod `^4.1.11`)

- **Trigger**: a `zod` major bump (5.x or later), OR `@hookform/resolvers` releases a new major (6.x), OR a `react-hook-form` form mysteriously sticks at `isSubmitting=true` after a failed validation — that is the exact symptom of a resolver that doesn't recognise the active Zod error shape.
- **Action**: confirm the resolver's Zod-version-compat path is still wired up. The v3 → v5 bump that landed with the M2 PR shifted the recogniser from `Array.isArray(error.errors)` (Zod 3 shape) to `error instanceof $ZodError` + `error.issues` (Zod 4 shape). A future Zod 5 will likely move the goalposts again, and the symptom is silent: validation passes through, the resolver re-throws, RHF leaves the form locked. The empty-submit assertion in `apps/web/e2e/dialog-keyboard.spec.ts` catches it; if it goes red after a bump, this is the first place to look.
- **Location**: `apps/web/package.json` (`@hookform/resolvers`, `zod`); call sites in `apps/web/src/components/groups/{create-group-dialog,group-settings-dialog}.tsx`.

## Supply-chain + licensing

## Design system

### No sub-AA palette token

- **Trigger**: a PR proposes a new foreground token that doesn't clear WCAG 1.4.3 AA (4.5:1 for normal text, 3:1 for large) against every surface in `packages/ui/src/tokens.ts` SURFACES.
- **Action**: don't ship it. Tailwind's `text-[var(--color-foo)]` lets any palette token be applied to any text element with no per-call-site review, so a sub-AA token in the shared palette is a foot-gun: the caller cannot tell from the class name that the contrast is unsafe, and a single muted-text token can produce dozens of AA-failing surfaces before anyone notices. If a specific call site genuinely needs sub-AA contrast under a 1.4.3 exemption (decorative non-text, brand mark, etc.), declare the hex inline at the call site with the rationale visible — keep the palette honest. The `tokens.test.ts` Layer-A gate enforces the rule at `pnpm test`.
- **Location**: `packages/ui/src/tokens.ts` (FOREGROUNDS), `packages/ui/src/styles.css` (palette declarations), `packages/ui/test/tokens.test.ts` (the gate).

## Repository internals — opportunistic migrations

### `Write<F>` brand on repository ports — opportunistic migration (currently applied to: `LibraryItemRepository`, `LearningActivityRepository`)

- **Trigger**: a future PR touches mutating methods on a repository port that hasn't yet adopted the brand. The remaining ports without it are: `UserRepository`, `InstanceAccessPolicyRepository`, `InstanceSettingsRepository`, `StudyGroupRepository`, `LearningTrackRepository`, `ActivityRecordRepository`, `StudySessionRepository`, `UploadCoordinationRepository`, `SystemFlagRepository`, `ObjectStorage`, `Scheduler`, plus three skeleton-stub repos.
- **Action**: on that PR, brand the touched port's mutating methods with `Write<F>` (from `packages/ports/src/_brand.ts`). Update the implementation methods in `packages/adapters/cloudflare/src/<repo>.ts` to use `markWrite(...)`. Add a per-port `it("XRepository: every branded write method is in CASES", ...)` block in `packages/adapters/cloudflare/test/killswitch-coverage.test.ts` mirroring the existing `LibraryItemRepository` / `LearningActivityRepository` shape. Tsc will then enforce that every branded write method has a CASES entry. The migration is opportunistic — no need for a sweep PR — but DO migrate any port you're already editing rather than leaving the next session to find half-branded surfaces.
- **Location**: `packages/ports/src/_brand.ts` (the brand machinery + this rationale); `packages/adapters/cloudflare/test/killswitch-coverage.test.ts` (the type-level enforcement site).

### `update-activity` use case is non-atomic across body + 3 child writes

- **Trigger**: M11 ships `ActivityRecord` rows whose existence depends on the activity's children being internally consistent (e.g., a learner's progress against a Part the activity claims to have).
- **Action**: re-evaluate the four-step orchestration in `packages/core/src/use-cases/update-activity.ts` (body update + `setLibraryRefs` + `setPrerequisites` + `setSuggestedSequences`). Each call is atomic on its own; a mid-sequence failure leaves the body updated but children stale, which the use case docstring concedes. The current "user retries → idempotent wholesale-replace converges" model is acceptable while no Records exist. Once Records exist, an inconsistent intermediate state during a retry could produce a Record against a Part that the activity no longer carries. Either compose the four writes into one D1 batch (requires a port-level rethink — children writes would need to surface from inside the parent UPDATE) or accept the eventual-consistency story explicitly with an integration test pinning the recovery shape.
- **Location**: `packages/core/src/use-cases/update-activity.ts`.

### Test files are not type-checked — `Write<F>` mock brand mismatches slip through

- **Trigger**: a `Write<F>`-branded port method picks up a new signature change, OR a test mock is allowed to drift from a port's real shape because the test file isn't compiled. Symptom: editor / LSP flags `Mock<...>` not assignable to `Write<...>` in `packages/core/test/**` but `pnpm typecheck` is green.
- **Action**: extend `packages/core/tsconfig.json` (and equivalent peer packages) to include `test/**/*.ts` so `tsc --noEmit` sees the test sources. Fix the resulting mock-vs-brand mismatches by wrapping mocks with `markWrite(...)` from `packages/ports/src/_brand.ts` (the same helper the adapter uses). Mirror the change to `packages/api`, `packages/auth`, `packages/adapters/cloudflare` if their tsconfigs have the same `src/`-only include. The cost is a one-off cleanup of existing mocks; the benefit is that `Write<F>` brand drift surfaces in `pnpm check` instead of leaking past lefthook + CI.
- **Location**: `packages/core/tsconfig.json` (includes), `packages/core/test/activity-use-cases.test.ts` and siblings (mocks needing `markWrite`).

### List endpoints whose detail sibling can 404 MUST share the visibility predicate

- **Trigger**: a new list endpoint lands whose detail route runs an authoritative visibility predicate (e.g. anything that gates by audience, post-close `hidden`, prerequisite locking) AND the list does not consult the same predicate. Indicator: the list endpoint loads a repository projection and `.filter()`s on a subset of the predicate's branches.
- **Action**: extract or reuse the existing shared helper (`packages/core/src/use-cases/_lib/load-visible-activities-for-track.ts` is the canonical M9 example) so the list and the detail surface run the SAME predicate. The list MUST omit rows whose detail route would 404 — otherwise the title leaks via the list and the click 404s, creating an enumeration oracle on whichever axis the list skipped (subset audience, prerequisite lock, etc.). M11 prerequisite-driven `locked` state and M12 visibility evolution will introduce new axes; the per-use-case half-fix pattern does not scale.
- **Location**: `packages/core/src/use-cases/_lib/load-visible-activities-for-track.ts` (the existing shared helper); any new `list*` use case + its repository projection.

## How to remove an entry

An entry leaves this list only when one of the following is true:

1. The trigger has fired and the action has been executed (the reassess is done; the decision stands or has moved).
2. The underlying tool is no longer in the stack.
3. A maintainer-approved governance change replaces the watched tool.

Entries accumulate slowly. If this list grows past ~10 items, reconsider whether any of them should become deterministic CI checks instead.
