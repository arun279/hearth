# Deployment runbook

Operational playbook for standing up a production Hearth instance on
Cloudflare (Workers + D1 + R2) and keeping it running. Read `docs/free-tier-guardrails.md`
first — the killswitch design is explained there, not here.

## 1. One-time bootstrap per instance

### 1.1 Cloudflare account

1. Create a Cloudflare account. If possible, do **not** add a payment method.
   However: **R2 has no Cloudflare-side spend cap** (CF MVP, in the
   community forum: "You can't limit it. The best you can do is create
   alerts") — so the absence of a card is only a partial belt. Overages
   accrue silently and R2 blocks only at the next preauthorization failure,
   which may be days after the overage. Our adapter gate + hourly poller
   (M17) + per-instance byte quota (M6) are the primary defense; the card
   absence is a last-resort suspender.
2. Create a D1 database: `wrangler d1 create hearth`. Copy the
   `database_id` into `apps/worker/wrangler.jsonc` under `d1_databases[0]`.
3. Create an R2 bucket: `wrangler r2 bucket create hearth-storage`. Use
   **Standard** storage class only — never Infrequent Access (IA). IA has
   no free tier and a $9.90/M ops minimum; it is the #1 source of surprise
   R2 bills in CF community reports.

### 1.2 Google OAuth client

1. In Google Cloud Console, create an OAuth 2.0 Client ID (Web application).
2. Authorized JavaScript origins: `https://hearth.wiki`.
3. Authorized redirect URIs: `https://hearth.wiki/api/auth/callback/google`.
4. Copy the client id and secret into Worker secrets (next step).

### 1.3 Worker secrets

Set once:

```bash
cd apps/worker
wrangler secret put GOOGLE_OAUTH_CLIENT_ID
wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
wrangler secret put BETTER_AUTH_SECRET          # openssl rand -base64 32
wrangler secret put KILLSWITCH_TOKEN            # openssl rand -hex 32
wrangler secret put HEARTH_BOOTSTRAP_OPERATOR_EMAIL
```

Optional:

```bash
wrangler secret put SENTRY_DSN            # if using Sentry
wrangler secret put DISCORD_WEBHOOK_URL   # if using Discord alerter
```

`BETTER_AUTH_URL` and `BETTER_AUTH_TRUSTED_ORIGINS` are public `vars` in
`wrangler.jsonc`, not secrets.

### 1.4 First deploy

```bash
pnpm --filter @hearth/worker deploy:upload
pnpm --filter @hearth/worker deploy:release
```

This is the canonical path — `wrangler versions upload` followed by
`wrangler versions deploy --yes`. **Never run `wrangler deploy` directly.**
The split gives atomic traffic flips and one-command rollback
(`wrangler rollback`).

### 1.5 First sign-in

Open `https://hearth.wiki`. Click **Sign in with Google**. The admission +
session-guard bootstrap-bypass admits the bootstrap email, and
`user.create.after` seeds `approved_emails` + `instance_operators`. The
SPA then shows `isOperator: true`.

## 2. Routine deploy

Every merge to `main` runs `.github/workflows/deploy.yml` which does:

1. Build all packages (`pnpm build`).
2. Apply pending D1 migrations (`wrangler d1 migrations apply hearth --remote`).
3. Upload the Worker version (`wrangler versions upload`).
4. Deploy the version (`wrangler versions deploy --yes`).
5. Upload Sentry source maps (if configured).
6. Post a Discord notification (if configured).

If the migration step fails, the Worker version is not promoted; the
current production version keeps serving.

## 3. Rollback

```bash
cd apps/worker
wrangler versions list                     # find the last-good version id
wrangler rollback --version-id <id>
```

Rollback is traffic-only — D1 migrations are not reverted. If a bad
migration is the cause, restore D1 from Time Travel (within 7 days on the
free plan) or from the weekly R2 backup (older). Both paths are scripted in
`scripts/restore-drill.sh` once that lands.

## 4. Killswitch operations

### 4.1 Read the current mode

```bash
curl -H "Authorization: Bearer $KILLSWITCH_TOKEN" \
  https://hearth.wiki/api/v1/admin/killswitch
```

Returns `{ mode, reason, lastTransitionAt }`. Also reachable via a
`?token=…` query parameter so an operator can bookmark the URL on a phone.

### 4.2 Flip modes

```bash
# pause writes (reads still work)
curl -X POST -H "Authorization: Bearer $KILLSWITCH_TOKEN" \
  -H "content-type: application/json" \
  -d '{"mode":"read_only","reason":"Investigating elevated D1 writes"}' \
  https://hearth.wiki/api/v1/admin/killswitch

# shut everything except /healthz + /api/v1/admin
curl -X POST ... -d '{"mode":"disabled","reason":"..."}' ...

# back to normal
curl -X POST ... -d '{"mode":"normal","reason":"All clear"}' ...
```

The admin endpoint is deliberately exempt from the killswitch middleware
and the write-rate-limiter so an operator can always flip back out of
`disabled`. The adapter gate cache is invalidated on POST so the operator's
own isolate sees the change immediately; other isolates catch up within 30
seconds (the gate TTL).

### 4.3 Rotate the killswitch token

Monthly default; sooner on any suspected compromise:

```bash
NEW=$(openssl rand -hex 32)
wrangler secret put KILLSWITCH_TOKEN <<< "$NEW"
# update the operator's bookmark/password manager with the new value
```

No deploy is needed — the Worker reads `env.KILLSWITCH_TOKEN` per request.

## 5. Secrets list (authoritative)

| Name | Scope | Source | Rotation trigger |
|---|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | public (sent to Google) | Google Cloud Console | Replace when client is rotated. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | secret | Google Cloud Console | On suspected compromise or yearly per Google best-practice. |
| `BETTER_AUTH_SECRET` | secret | `openssl rand -base64 32` | On suspected compromise. Rotating invalidates all existing sessions. |
| `BETTER_AUTH_URL` | public var | wrangler.jsonc | — |
| `BETTER_AUTH_TRUSTED_ORIGINS` | public var | wrangler.jsonc | Editing requires a deploy. |
| `KILLSWITCH_TOKEN` | secret | `openssl rand -hex 32` | Monthly default; immediate on leak. |
| `HEARTH_BOOTSTRAP_OPERATOR_EMAIL` | secret (email is low-sensitivity but stays out of code) | Maintainer choice | Only when handing off instance ownership. |
| `SENTRY_DSN` | secret-ish | Sentry project settings | When Sentry project migrates. |
| `DISCORD_WEBHOOK_URL` | secret | Discord channel integration | On leak or channel migration. |

## 6. Emergency paths

| Symptom | First response |
|---|---|
| R2 op count approaching monthly free limit | POST `/admin/killswitch` with `mode=read_only` to freeze new uploads. Investigate via `docs/free-tier-guardrails.md` §5 (the poller query fields). |
| D1 daily write count approaching 90% | Same. Reads continue. |
| Unexpected billing notification from Cloudflare | POST `/admin/killswitch` with `mode=disabled`. Confirm no payment method is attached to the account. |
| Google OAuth broken after a client rotation | Update `GOOGLE_OAUTH_CLIENT_ID` + `_SECRET` secrets, redeploy (versions-upload is enough — no code change needed). |
| Operator lost killswitch token | Use wrangler CLI access (via the server's local-only shell) to run `wrangler secret put KILLSWITCH_TOKEN` with a new value. |
