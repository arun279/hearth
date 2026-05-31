# Developer runbook

How to clone, install, run, and sign in to a local Hearth instance for the first time. Written as a follow-along script — each numbered step either runs a command or edits a file.

## Prerequisites

- Node `>= 22.12.0` (use `nvm use` or `fnm use` against the `.nvmrc`).
- pnpm `>= 10.18.0` (`corepack enable` is enough — pnpm is self-installing via the package.json `packageManager` pin).
- A Google Cloud project with an OAuth 2.0 Client ID (Web application). The authorized redirect URIs must include `http://localhost:8787/api/auth/callback/google`.

## 1. Install and bootstrap

```bash
pnpm install
```

pnpm's `minimumReleaseAge: 1440` (24 h) will delay any freshly published package; that's deliberate — we don't chase zero-day supply-chain compromises. First install also registers the Lefthook pre-commit and pre-push hooks.

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
- `HEARTH_BOOTSTRAP_OPERATOR_EMAIL` — the Google account you'll sign in with during bootstrap. This is the one email that can sign in before any Approved Email list exists.
- `R2_ACCOUNT_ID` — your Cloudflare account ID (the 32-char hex in the dashboard URL).
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` — generated below in § "R2 bucket setup". Required: the worker presigns avatar / library PUT URLs against R2's S3-compatible API on every request, so missing keys fail at boot via Zod validation in `@hearth/config`.
- `R2_PUBLIC_ORIGIN` — the bucket's public read origin (`https://pub-…r2.dev` or your custom domain). Surfaced to the SPA via `/api/v1/me/context` so client bundles don't need to be rebuilt when the origin changes.

`SENTRY_DSN` and `DISCORD_WEBHOOK_URL` stay commented; the Worker skips those channels gracefully when they're absent.

### R2 bucket setup

A fresh deploy of Hearth needs three R2-side configuration steps before avatars (and, in M5, library uploads) work end-to-end. None of them are version-controlled — they live in Cloudflare account state — so they're easy to forget on a clean install. Run through this list before the first deploy or when bringing up a new dev bucket.

1. **Create the bucket** (if you haven't):

   ```bash
   pnpm exec wrangler r2 bucket create hearth-storage
   ```

2. **Mint S3-compatible credentials** scoped to the bucket. In the Cloudflare dashboard: R2 → Manage R2 API Tokens → Create Account API Token → permission **"Object Read & Write"** → **Apply to specific buckets only** → select `hearth-storage`. Copy the **Access Key ID** and **Secret Access Key** immediately (the secret is only shown once). Use those values for `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`.

3. **Enable public read** so the SPA can render `<img src="${R2_PUBLIC_ORIGIN}/avatars/…">` without authentication. In the bucket → Settings → **Public access** → enable the **R2.dev subdomain** (or attach a custom domain). Copy the resulting URL (no trailing slash) into `R2_PUBLIC_ORIGIN`.

4. **Set the bucket CORS policy** so the SPA can `PUT` directly to the presigned URL the worker mints. The Activity Player landing in § 8c adds `Range` + media expose-headers — once you ship that, use the recipes in § 8c instead. For initial bring-up keep the two environments split:

   `r2-cors-dev.json` (apply to your dev bucket only):

   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:5173", "http://localhost:8787"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["Content-Type"],
       "ExposeHeaders": [],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   `r2-cors-prod.json` (apply to the production bucket only, after signing wrangler in to the prod account):

   ```json
   [
     {
       "AllowedOrigins": ["https://hearth.wiki"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["Content-Type"],
       "ExposeHeaders": [],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Apply each against the right account:

   ```bash
   pnpm exec wrangler r2 bucket cors put hearth-storage --file r2-cors-<env>.json
   ```

   Both recipes are idempotent.

5. **In production**, set the four secrets via `wrangler secret put` from `apps/worker/`:

   ```bash
   cd apps/worker
   pnpm exec wrangler secret put R2_ACCOUNT_ID
   pnpm exec wrangler secret put R2_ACCESS_KEY_ID
   pnpm exec wrangler secret put R2_SECRET_ACCESS_KEY
   pnpm exec wrangler secret put R2_PUBLIC_ORIGIN
   ```

6. **Smoke-check** by uploading any object and curling its public URL:

   ```bash
   curl -I "${R2_PUBLIC_ORIGIN}/avatars/<some-known-key>"
   ```

   Expect `200 OK` with the right `Content-Type`. A 404 means public access wasn't enabled; a CORS-related browser error means step 4 was skipped.

## 3. Apply database migrations

```bash
pnpm db:migrate:dev
```

This applies every migration in `packages/db/migrations/` to the local D1 (stored under `apps/worker/.wrangler/state/v3/d1/`). The first migration creates all 30 tables, the second adds the FTS5 virtual table + triggers, the third seeds the singleton `instance_settings` row.

You can re-run this command any time — Wrangler tracks applied migrations in its own metadata and only runs what's new.

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

Open `http://localhost:5173`. The SPA proxies `/api` to `http://localhost:8787` via `apps/web/vite.config.ts`.

## 5. First sign-in

Click **Sign in with Google**, choose the account whose email matches `HEARTH_BOOTSTRAP_OPERATOR_EMAIL`. The first successful sign-in:

1. Better Auth's `user.create.before` hook runs `admissionCheck`. Because your email matches the bootstrap env var, the declarative bootstrap branch admits you even though no Approved Email list exists yet.
2. `session.create.before` runs `sessionGuard` — same bootstrap branch admits the session.
3. `user.create.after` fires post-commit and calls `bootstrapIfNeeded`, which idempotently inserts your email into `approved_emails` and your user id into `instance_operators` in a single D1 `batch()` via PK conflict guards.
4. The SPA reloads `/api/v1/me/context` and you appear with `isOperator: true`.

Subsequent sign-ins (you) take the normal approved-email path because step 3 seeded the row; the declarative branch stays as a durable recovery lane — if `approved_emails` or `instance_operators` gets wiped, the next sign-in re-seeds via the same hook.

Try signing in with a different Google account to see the friendly rejection state (`code: "email_not_approved"`). No user row is created.

### Recovery via `pnpm bootstrap-operator`

When the maintainer's `users` row already exists but `approved_emails` / `instance_operators` got wiped (e.g., a manual SQL `DELETE`, a revoke that should be undone, or a local cleanup that destroyed admission rows), `pnpm bootstrap-operator` restores those entries idempotently without requiring a fresh sign-in.

```sh
pnpm bootstrap-operator              # local D1
pnpm bootstrap-operator --remote     # production D1 (wrangler d1 --remote)
pnpm bootstrap-operator --check      # exit non-zero if either row is missing
```

The script reads `HEARTH_BOOTSTRAP_OPERATOR_EMAIL` from `.dev.vars` (local) or from the Workers secret env (remote), confirms the user row exists, then runs `INSERT OR IGNORE` on both tables in one batch. It deliberately does not create the `users` row — Better Auth owns identity insertion; if there's no user row yet, sign in once via OAuth first.

## 6. Useful day-to-day commands

| Goal                                           | Command                                     |
| ---------------------------------------------- | ------------------------------------------- |
| Run every quality gate (pre-PR)                | `pnpm check`                                |
| Regenerate D1 migrations after a schema change | `pnpm db:generate` then commit the new file |
| Regenerate TanStack Router file tree           | `pnpm --filter @hearth/web generate:routes` |
| Verify Better Auth schema hasn't drifted       | `pnpm db:check-auth`                        |
| Rebuild the library FTS5 search index          | `pnpm restore:fts` (`-- --remote` for prod) |
| Run a single package's tests                   | `pnpm --filter @hearth/auth test`           |
| Format                                         | `pnpm format`                               |

The FTS5 rebuild is normally unnecessary — the AFTER INSERT mirror trigger keeps the index in lockstep with `library_items`. Reach for it when the search results page disagrees with the library list (e.g., after a hand-edited D1 import or a corrupted segment), or as the final step of a restore drill.

## 7. Adding approved emails

The bootstrap email is seeded automatically on first sign-in. After that, use the `Admin → Instance settings → Approved emails` tab: `name@example.com` + an optional note, or paste a list (one email per line) via the "Paste a list" affordance.

The older `pnpm approve-email …` shell helper is kept for direct DB access during tests or recovery. Note: it inserts into `approved_emails` but does not run the session-cascade path — for realistic flows, prefer the UI or the `DELETE /api/v1/instance/approved-emails/:email` endpoint, which hard-deletes live sessions for the matching users in the same batch as the email removal.

For the special case of restoring the bootstrap operator after their admission rows were wiped, use `pnpm bootstrap-operator` (see § 5). It's the only helper that targets both `approved_emails` and `instance_operators` in one idempotent batch.

## 8. Testing the multi-operator flow

Two Google accounts and two browsers (or one normal + one Incognito) make it possible to exercise the operator handoff locally:

1. Sign in with the bootstrap account in the main browser.
2. In a second profile, sign in with a second Google account. The attempt is rejected until the bootstrap operator adds that email via `Admin → Instance settings → Approved emails`.
3. Re-attempt sign-in in the second browser — it succeeds. The second user appears as a participant (`isOperator: false`).
4. Back in the first browser, `Admin → Instance settings → Operators →
   Grant operator` with the second user's email. The second browser's next `/me/context` refresh flips `isOperator: true`.
5. Try `DELETE /api/v1/instance/operators/<bootstrap-user-id>` from the second browser. Before handoff, the second operator must still exist first — revoking the last operator returns `would_orphan_operator`.

Removing an Approved Email while the matching user is signed in is the only action that hard-deletes live sessions. Watch the second browser: the next API call returns 401 and the SPA redirects to the sign-in screen.

## 8a. Enrolling a second member in a Learning Track

Most flows past the group lifecycle (track activities, sessions, the People tab, the orphan-facilitator guard on group-member removal) need at least two real members on the same track. The shortest path with the dev session helper:

1. With the bootstrap operator signed in, create a Study Group and a Learning Track. The creator is auto-enrolled as the track's first facilitator.
2. Approve the second user's email up front (the consume path reuses the instance-level allowlist):

   ```bash
   curl -X POST http://localhost:8787/api/v1/instance/approved-emails \
     -H "content-type: application/json" \
     -H "cookie: better-auth.session_token=$(pnpm -s local-session --seed --cookie-only)" \
     --data '{"email":"member2@local.dev"}'
   ```

3. Mint a session for the second user with `pnpm local-session --seed --email
   member2@local.dev --json` and grab the cookie value.
4. Invite that email from the group's people page (admin-only `Invite` button) or via `POST /api/v1/g/:groupId/invitations`. Either path returns a token.
5. Consume the invitation as the second user — visit `/invite/<token>` in a second browser/profile (cookies don't share between profiles), or POST `/api/v1/invitations/consume` with `{ "token": "..." }`.
6. The second user can now self-enroll in the track via the `Enroll` button on the track home, or you can promote them to facilitator from the People tab (the admin-only `Promote` action). The orphan-facilitator guard on group removal lights up once a track has at least one facilitator who is the _only_ facilitator on that track — the easiest way to reproduce that state is to invite a third user, promote them to facilitator on a different track, then try removing them from the group.

## 8b. Composing your first Learning Activity

Once a Study Group, a Learning Track, and at least one enrolled facilitator exist (see § 8a), you can compose Learning Activities. The composer is a single-scrolled modal; the create + edit paths share the same component.

1. Visit `/g/<groupId>/t/<trackId>` and click `+ New activity` on the Activities tab. The button is gated on facilitator authority — Group Admins and Track Facilitators see it; participants don't.
2. **Title** is required; the asterisk + the on-submit inline error (`role="alert"`) name it explicitly. Description is optional.
3. **Add Parts** from the palette. Five kinds ship in M8: Reading, Audio, Video, Reflection, and Embed. Reading / Audio / Video each open a Library Item picker filtered to the matching display kind (PDF/doc/image for Reading, audio MIME for Audio, video MIME for Video). Reflection takes a prompt; Embed takes an https URL plus a provider radio (YouTube / Spotify / Generic). Reorder with the up/down arrow buttons; remove with the X. Quiz and Session Parts are hidden in M8 — their player surfaces ship in later milestones.
4. **Audience** defaults to "Everyone enrolled." Switching to "Selected participants" reveals a checkbox roster sourced from current track enrollments. Departed enrollees fall out automatically (left-track members aren't selectable).
5. **Window** is optional. Opens / Due / Closes are `<input type="datetime-local">` — the helper line under the row discloses your browser timezone (`America/Chicago`, etc.) so you know what zone the saved instant reflects. Setting Closes reveals a **Post-close policy** radio group ("Visible · still completable" / "Visible · locked" / "Hidden"). The picker requires an explicit choice; there's no destructive auto-seed.
6. **Completion rule** picks between "Honor-system — learner marks complete" (default) and "Auto — all Parts marked complete."
7. **Cross-activity prereqs / suggested-next** appear once at least one other activity exists on the track. Both are multi-select; the helper copy will get richer when records and visibility ship.
8. Click `Create activity`. The dialog's sticky footer keeps the save button visible regardless of scroll position. On validation failure, the inline alert auto-scrolls into view.
9. **Edit**: click any activity row in the Activities tab. The composer reopens seeded with the existing activity. The dirty-state guard is live — pressing Esc with unsaved edits surfaces a "Discard your changes?" sub-modal; pristine composers still close instantly.
10. **Delete**: in edit mode, click `Delete` (left side of the footer) and confirm with the type-to-confirm phrase. The mutation refuses if any other activity holds this one as a hard prerequisite — the deny code (`activity_has_dependents`) names the offending titles.

The Library Item detail (`/g/<groupId>/library`, click an item) shows a "Used in N activities" list — useful when a steward wants to check what would block a hard-delete before they retire an item.

## 8c. Working on the Activity Player

The Activity Player is the read/listen/watch surface that renders a composed activity. Clicking any activity row on the Activities tab navigates to `/g/<groupId>/t/<trackId>/a/<activityId>`, replacing the full viewport (no sidebar / tab bar / breadcrumb chrome — it's a reading surface, not a dashboard). Authority users see an explicit Edit pencil on each row that opens the composer dialog without leaving the tab.

To exercise it locally:

1. Compose an activity that mixes at least one PDF reading Part (drop a small PDF into the Library first; see § 8.5 "Testing the library upload pipeline") and one Embed Part (paste a `https://www.youtube.com/watch?v=…` URL — the player normalises it to the `youtube.com/embed/<id>` form).
2. From the Activities tab, click the row to open the player. The desktop layout renders a 240px FlowSidebar on the left with one row per Part; the mobile layout (≤md) renders a sticky pill bar at the top instead.
3. Use the sidebar / pill bar to flip Parts; the active Part id rides in `?part=<partId>`, so a browser refresh preserves position. Pasting an unknown part id falls back to the first Part with a single-line toast.
4. The PDF renderer is loaded behind `React.lazy(() => import("./parts/read-part"))` — the first time you open a PDF Part, the browser fetches a separate ~400 KB chunk; subsequent opens are instant from cache. `pnpm --filter @hearth/web test:bundle` is the gate that keeps that chunk dynamic.
5. **Reflection** Parts autosave as you type (debounced ~0.8 s); the indicator beside the word-count meter cycles "Saving…" / "Saved", the draft survives a refresh, and it also flushes when the tab is hidden. The visibility selector beside it sets a record-level override — Track / Track only / Just me — and notes that facilitators always see full work.
6. **Quiz** Parts collect per-question answers and grade them on submit (honor-system): each question shows correct / incorrect / ungraded feedback with any author explanation, plus an "N of M graded correct" summary; re-submitting is allowed. Short-answer answer keys use RE2 syntax (linear-time, so a pathological key cannot pin CPU); grading runs server-side and answer keys never reach the browser. An uncompilable key is rejected when the activity is saved, and otherwise fails soft to "ungraded."
7. `Mark complete` renders as a placeholder with `aria-disabled="true"` and a "coming soon" tooltip — per-Part completion state lands in a later milestone alongside Activity Records.
8. `Previous` / `Next` chevrons navigate through `flow.displayOrder`. The bottom edge always shows where the participant is and where they can go.

### R2 CORS for media + PDF playback

The Activity Player fetches PDFs via XHR (pdf.js issues `Range` requests for partial loads) and streams audio / video via HTML5 elements (the browser issues `Range` for seek + progressive playback). For both to work over the signed-GET URLs the worker mints, the bucket's CORS policy needs to permit `GET` with the `Range` header and expose `Content-Range`, `Accept-Ranges`, and `Content-Length`.

The recipes below replace the basic CORS in § 2. **The dev recipe must NEVER be applied to the production bucket** — `http://localhost` origins on the prod bucket would let a page running on any user's localhost fetch signed content from prod via `fetch`. Keep the two recipes in separate files and apply each against the right account.

**Dev bucket** (`r2-cors-dev.json`):

```json
[
  {
    "AllowedOrigins": ["http://localhost:5173", "http://localhost:8787"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["Content-Type", "Range"],
    "ExposeHeaders": ["Content-Range", "Content-Length", "Accept-Ranges", "ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Apply against the dev account:

```bash
pnpm exec wrangler r2 bucket cors put hearth-storage --file r2-cors-dev.json
```

**Production bucket** (`r2-cors-prod.json`):

```json
[
  {
    "AllowedOrigins": ["https://hearth.wiki"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["Content-Type", "Range"],
    "ExposeHeaders": ["Content-Range", "Content-Length", "Accept-Ranges", "ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Apply by signing in to `wrangler` with the production account first, then:

```bash
pnpm exec wrangler r2 bucket cors put hearth-storage --file r2-cors-prod.json
```

Both recipes are idempotent — safe to re-run on every deploy. If you have a custom prod domain other than `hearth.wiki`, swap it in `r2-cors-prod.json`.

## 9. Inspecting R2 (avatars and library uploads)

The Worker writes uploads to the R2 binding named `STORAGE` under two prefixes:

- `avatars/<userId>/<groupId>/<sha>` — group-membership avatars.
- `library/<groupId>/<itemId>/<revisionId>` — Library Item revisions.

To see what's in the local bucket while the dev Worker is running, pass `--local` so Wrangler reads the Miniflare-backed bucket rather than the production R2 namespace:

```bash
# Newest objects first, capped at 50 — `--local` is load-bearing.
pnpm exec wrangler r2 object list hearth-storage --local --limit 50

# Inspect a specific avatar / library object.
pnpm exec wrangler r2 object get hearth-storage avatars/<userId>/<groupId>/<sha> --local --pipe | file -
pnpm exec wrangler r2 object get hearth-storage library/<groupId>/<itemId>/<revisionId> --local --pipe | file -
```

If a `pending_uploads` row sticks around past its `expiresAt` even after the cron has fired, look at the corresponding R2 key here — if R2 has the object but the row is gone, the sweep didn't run; if neither, both halves cleaned up.

The `<groupId>` segment is what `finalizeAvatarUpload` asserts against and what `requestLibraryUpload` mints into the `pending_uploads` storage key — see also the killswitch coverage test (`packages/adapters/cloudflare/test/killswitch-coverage.test.ts`) for the resilience invariant that `gate.assertWritable()` runs before any R2 write.

### Testing the library upload pipeline

The four-step direct-to-R2 flow uses the same machinery as avatars but with longer-lived item identity. To exercise it locally:

1. Sign in as a Group Member (e.g. `pnpm local-session --seed`) and visit `/g/<groupId>/library`.
2. Click `+ Upload`, pick a small PDF / audio / video file, give it a title, and submit. The dialog shows three stages: **Reserving** (presign + write `pending_uploads`), **Uploading** (PUT directly to R2 — the request goes to Miniflare's R2 simulator on `wrangler dev`), and **Finalizing** (server `headObject` + the atomic `library_items` + `library_revisions` insert).
3. Inspect with `wrangler r2 object list hearth-storage --local --prefix library/`.
4. Add a revision: open the item from the list, click `Upload new revision`. The new revision becomes the current one; downloading from the item card always serves the current revision.
5. Retire the item from its detail modal — the row stays readable, but new uploads against the same item id return 409 `library_item_retired`.

The 80% byte-quota trip is enforced by `requestLibraryUpload`. To exercise it locally without uploading several GB, set `LIBRARY_R2_BYTE_BUDGET=100000000` (≈ 100 MB) in your `.dev.vars` and reload the dev worker. The trip ratio also has an env override (`LIBRARY_R2_BUDGET_TRIP_RATIO`, range `(0, 1]`). Production typically leaves both unset; the domain defaults (10 GB / 0.8) apply.

The hourly cron handler (`pending-uploads-sweep`) reaps abandoned uploads. Manually fire it during dev by hitting Wrangler's local scheduler endpoint:

```bash
curl 'http://localhost:8787/cdn-cgi/handler/scheduled?cron=0%20*%20*%20*%20*'
```

## 10. Resetting local state

If you want a clean database:

```bash
rm -rf apps/worker/.wrangler/state/v3/d1
pnpm db:migrate:dev
```

That wipes the Miniflare D1 store; your next Worker start reseeds the singleton `instance_settings` row via migration `0002`.

## 11. Troubleshooting

- **`pnpm db:migrate:dev` says "wrangler: not found"** — run `pnpm install` first; wrangler is a dev dependency of `apps/worker` and pnpm links it into place on install.
- **Sign-in succeeds but the SPA shows "Hearth is unreachable"** — the SPA hit `/api/v1/me/context` before the Worker was up. Refresh; Vite's proxy is lazy.
- **Google rejects `localhost`** — the Google OAuth client's authorized redirect URIs must contain `http://localhost:8787/api/auth/callback/google` exactly, with no trailing slash.
- **Cookies not persisting cross-port (5173 → 8787)** — check that the Worker's response sets `SameSite=Lax` and `Secure=false` in dev. Both are Better Auth defaults for `http://localhost`, but a stray `Secure=true` override breaks the session.
- **e2e fails locally on a long-running Vite dev server, especially after many edits to `packages/*/src/`** — symptom: a Playwright test that depends on a recently-edited UI primitive fails against the running dev server, but the same test passes against a fresh Vite (verifiable by `curl http://localhost:5173/@fs/<path>?import` returning stale content while `curl …?import&t=NOW` returns the current source). Cause: Vite 8.0.9 ships chokidar 3.6, whose single-file watch on cross-package source files can drop the watch during rapid atomic-rename sequences (Edit-tool / vim / build-on-save flows). Once dropped, Vite serves the cached transform from when the file was first imported regardless of disk state. Fix: kill and restart `pnpm --filter @hearth/web dev` (the Worker dev server can stay up). This is a Vite/chokidar upstream bug — see `docs/tripwires.md` § "Vite watcher fragility on cross-package source files" for the reassess trigger that retires this troubleshooting note.
