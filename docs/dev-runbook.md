# Developer runbook

How to clone, install, run, and sign in to a local Hearth instance for the
first time. Written as a follow-along script — each numbered step either runs
a command or edits a file.

## Prerequisites

- Node `>= 22.12.0` (use `nvm use` or `fnm use` against the `.nvmrc`).
- pnpm `>= 10.18.0` (`corepack enable` is enough — pnpm is self-installing
  via the package.json `packageManager` pin).
- A Google Cloud project with an OAuth 2.0 Client ID (Web application). The
  authorized redirect URIs must include `http://localhost:8787/api/auth/callback/google`.

## 1. Install and bootstrap

```bash
pnpm install
```

pnpm's `minimumReleaseAge: 1440` (24 h) will delay any freshly published
package; that's deliberate — we don't chase zero-day supply-chain compromises.
First install also registers the Lefthook pre-commit and pre-push hooks.

## 2. Configure secrets

Copy the example env into a gitignored `.dev.vars`:

```bash
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
```

Edit `apps/worker/.dev.vars`:

- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` — from Google Cloud.
- `BETTER_AUTH_SECRET` — generate with `openssl rand -base64 32`.
- `BETTER_AUTH_URL` — leave as `http://localhost:8787` for local dev.
- `BETTER_AUTH_TRUSTED_ORIGINS` — leave as `http://localhost:5173,http://localhost:8787`.
- `KILLSWITCH_TOKEN` — generate with `openssl rand -hex 32`.
- `HEARTH_BOOTSTRAP_OPERATOR_EMAIL` — the Google account you'll sign in with
  during bootstrap. This is the one email that can sign in before any
  Approved Email list exists.

`SENTRY_DSN` and `DISCORD_WEBHOOK_URL` stay commented; the Worker skips
those channels gracefully when they're absent.

## 3. Apply database migrations

```bash
pnpm db:migrate:dev
```

This applies every migration in `packages/db/migrations/` to the local D1
(stored under `apps/worker/.wrangler/state/v3/d1/`). The first migration
creates all 30 tables, the second adds the FTS5 virtual table + triggers, the
third seeds the singleton `instance_settings` row.

You can re-run this command any time — Wrangler tracks applied migrations in
its own metadata and only runs what's new.

## 4. Start the stack

Two terminals is the fastest loop.

Terminal 1 (Worker + Better Auth + D1):
```bash
pnpm --filter @hearth/worker dev
```

Terminal 2 (SPA with HMR):
```bash
pnpm --filter @hearth/web dev
```

Open `http://localhost:5173`. The SPA proxies `/api` to
`http://localhost:8787` via `apps/web/vite.config.ts`.

## 5. First sign-in

Click **Sign in with Google**, choose the account whose email matches
`HEARTH_BOOTSTRAP_OPERATOR_EMAIL`. The first successful sign-in:

1. Better Auth's `user.create.before` hook runs `admissionCheck`. Because
   there are zero active operators AND your email is the bootstrap email,
   the bootstrap-bypass admits you even though no Approved Email list
   exists yet.
2. `session.create.before` runs `sessionGuard` — same bootstrap-bypass.
3. `user.create.after` fires post-commit and calls `bootstrapIfNeeded`,
   which inserts your email into `approved_emails` and your user id into
   `instance_operators` in a single D1 `batch()`.
4. The SPA reloads `/api/v1/me/context` and you appear with
   `isOperator: true`.

Subsequent sign-ins (you or anyone else) go through the normal approved-email
path — the bootstrap window only opens while zero operators exist.

Try signing in with a different Google account to see the friendly rejection
state (`code: "email_not_approved"`). No user row is created.

## 6. Useful day-to-day commands

| Goal | Command |
|---|---|
| Run every quality gate (pre-PR) | `pnpm check` |
| Regenerate D1 migrations after a schema change | `pnpm db:generate` then commit the new file |
| Regenerate TanStack Router file tree | `pnpm --filter @hearth/web generate:routes` |
| Verify Better Auth schema hasn't drifted | `pnpm db:check-auth` |
| Run a single package's tests | `pnpm --filter @hearth/auth test` |
| Format | `pnpm format` |

## 7. Adding approved emails (until the operator admin UI lands)

Until the admin surface for instance operations ships (next milestone), there
is no HTTP endpoint for managing the approved-email roster. The bootstrap
email is seeded automatically on first sign-in; additional emails need to be
inserted directly.

```bash
pnpm approve-email friend@example.com "optional note"
```

The helper reads the first active operator from `instance_operators` and
attributes the new row to them (so the foreign key is satisfied). Run it
**after** your first operator sign-in — it fails loudly if no operator
exists yet.

To see the current roster:

```bash
pnpm --filter @hearth/worker exec wrangler d1 execute hearth --local \
  --command "SELECT email, note, added_at FROM approved_emails ORDER BY added_at DESC"
```

To revoke an email (the matching user's sessions are not auto-invalidated —
that cascade lands with the admin UI milestone):

```bash
pnpm --filter @hearth/worker exec wrangler d1 execute hearth --local \
  --command "DELETE FROM approved_emails WHERE email = 'friend@example.com'"
```

## 8. Resetting local state

If you want a clean database:

```bash
rm -rf apps/worker/.wrangler/state/v3/d1
pnpm db:migrate:dev
```

That wipes the Miniflare D1 store; your next Worker start reseeds the
singleton `instance_settings` row via migration `0002`.

## 8. Troubleshooting

- **`pnpm db:migrate:dev` says "wrangler: not found"** — run `pnpm install`
  first; wrangler is a dev dependency of `apps/worker` and pnpm links it
  into place on install.
- **Sign-in succeeds but the SPA shows "Hearth is unreachable"** — the SPA
  hit `/api/v1/me/context` before the Worker was up. Refresh; Vite's proxy
  is lazy.
- **Google rejects `localhost`** — the Google OAuth client's authorized
  redirect URIs must contain `http://localhost:8787/api/auth/callback/google`
  exactly, with no trailing slash.
- **Cookies not persisting cross-port (5173 → 8787)** — check that the
  Worker's response sets `SameSite=Lax` and `Secure=false` in dev. Both are
  Better Auth defaults for `http://localhost`, but a stray `Secure=true`
  override breaks the session.
