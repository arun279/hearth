# Free-tier guardrails

The goal is **$0/month, guaranteed**. Every external service Hearth uses has a
free-tier ceiling with documented behavior at the limit. This document
captures the current numbers, the reset cadence, and — most importantly — what
happens when a limit is hit.

**Numbers were verified against Cloudflare's public docs (April 2026). Anyone
bumping a threshold in code must re-verify the source URL cited here.**

## 1. Limits table

| Service | Metric | Free limit | Reset | Behavior at limit |
|---|---|---|---|---|
| Workers | Requests | **100,000/day** | Daily 00:00 UTC | Cloudflare returns Error 1027. (`workers/platform/limits/`) |
| Workers | CPU time | **10 ms/request** | Per-request | Request fails with CPU exceeded. |
| Workers | Subrequests | 50/request | Per-request | Excess subrequests rejected. |
| Workers | Worker size | 3 MB | — | Deploy blocked past 3 MB gzipped. |
| Workers | Cron triggers | 5/account | — | Additional triggers rejected. |
| D1 | Rows read | **5,000,000/day** | Daily 00:00 UTC | D1 API returns errors; queries blocked until reset. |
| D1 | Rows written | **100,000/day** | Daily 00:00 UTC | Same as reads. |
| D1 | Storage total | 5 GB | — | New inserts fail. |
| D1 | Databases | 10/account | — | Extra databases rejected. |
| D1 | Queries/invocation | 50 | Per-request | Excess queries fail within the Worker. |
| D1 | Time Travel | 7 days | — | Older restore points unavailable. |
| R2 | Storage | 10 GB | — | **NO CF-side hard cap.** Overage accrues silently and is invoiced at cycle end if a card is on file. Without a card, R2 writes start failing only after Cloudflare's end-of-cycle preauthorization fails; there is no pre-write block. Our adapter gate + per-instance byte quota is the only real defense. |
| R2 | Class A ops (write/list/multipart) | 1,000,000/month | Monthly (billing anniversary) | Same — no CF-side cap; bills at $4.50/M past free tier. |
| R2 | Class B ops (read/HEAD) | 10,000,000/month | Monthly | Same — bills at $0.36/M past free tier. |
| R2 | Egress | Free (unlimited) | — | Zero egress fees, always. |
| Analytics Engine | Data points/invocation | 250 | Per-request | `writeDataPoint` excess is silently dropped (writes are fire-and-forget). |
| Analytics Engine | Data points/day | **100,000** | Daily | Per `analytics/analytics-engine/pricing/`. Currently unbilled — "you will not be billed for your use of Workers Analytics Engine" per CF docs (2026-04). |
| Analytics Engine | Retention | 3 months | — | Older rows age out. |
| Analytics Engine | Read queries/day | 10,000 | Daily | SQL API throttles at 429 when exceeded. |

**Sources**
- Workers: `https://developers.cloudflare.com/workers/platform/limits/` and
  `/pricing/` (both verified 2026-04).
- D1: `https://developers.cloudflare.com/d1/platform/limits/` and `/pricing/`.
- R2: `https://developers.cloudflare.com/r2/pricing/`.
- Analytics Engine: `https://developers.cloudflare.com/analytics/analytics-engine/limits/`.

## 2. Which services fail-closed on their own vs. need the killswitch

| Service | CF-native behavior at limit | Killswitch needed? |
|---|---|---|
| Workers requests | Hard-blocks at 100k/day (Error 1027) | No — the service already fails closed. The killswitch is a second line of defense if a single noisy instance eats the budget before end-of-day. |
| D1 reads/writes | Hard-blocks at the daily limit, returns errors | No — fails closed. Killswitch trips at 90% so operators get a chance to investigate before the hard stop disrupts users. |
| R2 ops | **There is no CF-side hard cap.** Cloudflare MVP, on their community forum: "You can't limit it. The best you can do is create alerts." Overage accrues silently; invoice lands at cycle end. If a card is on file anywhere on the account, R2 will bill against it. Without a card, you accrue debt until Cloudflare's next preauthorization fails, which can be days after the overage. | **Yes — this is the killswitch's primary job, and R2 is its primary target.** Our defenses, in order: (1) the hourly poller flips to `read_only` at 90% of either op-class monthly limit or the storage limit; (2) the adapter gate rejects any R2 write while the flag is non-normal; (3) a per-instance byte quota (declared upload size) is enforced on presigned URL issuance before R2 sees the bytes at all. |
| Analytics Engine | Silently drops excess data points per invocation. No documented monthly cap on the free plan. | No hard block, but we still enforce an Evidence-Signal write budget (≤ 50/user/day) via CI test so a runaway poller can't warp dashboards. |

## 3. The killswitch threshold rationale

The hourly poller (M17) checks the GraphQL Analytics API and flips the
`system_flags.killswitch_mode` at these thresholds:

- **70% of the worst daily metric**: Discord warning only.
- **85%**: Discord warning + `read_only` staged (still normal at this point).
- **90%**: **flip to `read_only`** — writes blocked at the HTTP boundary and
  at the adapter layer. Reads continue so users can still view material.
- **Fail-closed-after-2-misses**: if the poller has been unable to reach the
  GraphQL API for two consecutive hourly runs, flip to `read_only`
  automatically. Blindness is treated as if the worst metric is already at 90%.

These percentages give an operator roughly 2.4 hours of headroom at the
Workers Free daily reset (~100k/day ÷ 24h, tripping at 90k). For D1 writes the
same percentage is 90,000 rows/day — the Evidence-Signal budget (50
writes/user × 20 users × ≈1 hour between polls) is well under this and the
killswitch is the defense against a bug that escapes the budget test.

## 4. Defense-in-depth layering

1. **Adapter-level `gate.assertWritable()`** (`@hearth/adapter-cloudflare`).
   Every D1 + R2 write method calls it first; it throws `KillswitchBlocked`
   when the flag is `read_only` or `disabled`. Enforced by
   `packages/adapters/cloudflare/test/killswitch-coverage.test.ts`.
2. **HTTP middleware** (`@hearth/api`). Short-circuits writes in `read_only`;
   short-circuits everything except `/healthz` and `/api/v1/admin/*` in
   `disabled`. Enforced by `packages/api/test/killswitch-middleware.test.ts`.
3. **Cloudflare Rate Limiting** (Worker binding). 60 writes/minute per user,
   10 auth attempts/minute per IP. **Internal edge counters only — NO D1, KV,
   or DO writes**, verified from Cloudflare's docs: "The underlying counters
   are cached on the same machine that your Worker runs in, and updated
   asynchronously in the background by communicating with a backing store
   that is within the same Cloudflare location." (`workers/runtime-apis/bindings/rate-limit/`).
   Legal `period` values are exactly `10` or `60`.
4. **No payment method on the Cloudflare account** — partial belt. Keeps
   the account from being auto-billed on R2 overage, but Cloudflare still
   allows writes to accrue and only blocks at the next preauthorization
   failure, which may be days later. This is *a* line of defense, not
   *the* line. Adding a card anywhere on the account (including for
   Workers Paid) makes R2 overage billing automatic — there is no R2-
   specific billing toggle.
5. **Standard storage class only.** Never use Infrequent Access (IA).
   Community reports show most "surprise R2 bills" on the free tier come
   from accidentally selecting IA, which has no free tier and a $9.90/M
   ops minimum. Our `wrangler.jsonc` provisions a Standard bucket only.
6. **Budget alerts are NOT available on a pure free-plan account** — they
   require Pay-as-you-go status. Cloudflare docs: "Budget alerts are
   available to Pay-as-you-go accounts only" (`billing/manage/budget-alerts/`).
   If an operator ever enrolls in PAYG (for any reason), the first
   post-enrollment step is to configure a $0.01 account-wide budget alert
   as a fourth line of defense.

## 5. Operator-pollable usage query

The hourly cron polls the Cloudflare GraphQL Analytics API:

- **Endpoint**: `https://api.cloudflare.com/client/v4/graphql`
- **Token scope**: `Account` → `Account Analytics` → `Read`
- **API rate limit**: 300 queries per 5-minute window
- **Fields**:
  - Workers requests: `workersInvocationsAdaptive.sum.requests`
  - D1 rows read/written: `d1AnalyticsAdaptiveGroups.sum.{rowsRead, rowsWritten}` (dims: `date`, `databaseId`)
  - R2 ops: `r2OperationsAdaptiveGroups.sum.requests` grouped by `dimensions.actionType` (Class A vs B is derived from `actionType`, not a first-class field)
  - Analytics Engine: **not pollable via GraphQL** — uses the AE SQL API at
    `/accounts/{id}/analytics_engine/sql` if polling becomes necessary later.

Sources:
- `https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/`
- `https://developers.cloudflare.com/analytics/graphql-api/limits/`
- `https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/`
- `https://developers.cloudflare.com/d1/observability/metrics-analytics/`
- `https://developers.cloudflare.com/r2/platform/metrics-analytics/`

## 6. Library-level bugs we mitigate

| Bug | Impact | Mitigation in this repo |
|---|---|---|
| `better-auth#9070` (open, Apr 2026): `session.create.before` fires BEFORE the deferred `user.create.after` hook (per PR `better-auth#7345`, merged Jan 2026). | First-ever operator sign-in would be rejected by the session guard's admission re-check, because the `user.create.after`-driven bootstrap seed has not committed yet. | `packages/auth/src/admission.ts` + `session-guard.ts` carry a **bootstrap-bypass**: if zero active operators AND the email matches `HEARTH_BOOTSTRAP_OPERATOR_EMAIL`, admit. The `user.create.after` hook still seeds `approved_emails` + `instance_operators` idempotently so subsequent sign-ins take the normal approved-email path. Covered by `packages/auth/test/admission.test.ts`. |
| `better-auth#8849` (open, Mar 2026): `usePlural: true` + `experimental.joins` → 500 on sign-in ("multiple relations" error). | Breaks sign-in entirely. | We use `usePlural: true` but do NOT enable `experimental.joins`. `packages/auth/src/create-auth.ts` deliberately omits that option. |
| `drizzle-team/drizzle-orm#5659` (open, Apr 2026): `drizzle-zod` `coerce: true` + Zod 4 makes coerced fields' input type `unknown`. | Zod schemas generated from columns have the wrong input type, breaking form resolvers. | Convention: no `coerce:` in column→schema generators. Coercion happens at the API boundary in route handlers. Enforced by `scripts/check-conventions.mjs`. |

## 7. Rehearsing the failure paths

Operators should have run through these at least once before relying on the
killswitch:

1. **Read-only mode**: flip via `POST /api/v1/admin/killswitch` with a bearer
   token and `{ "mode": "read_only" }`. Verify the SPA still loads, writes
   return 503 with `code: "read_only"` in the RFC 7807 body.
2. **Disabled mode**: flip to `disabled`. Verify `/healthz` still returns
   `200 ok`, `/api/v1/admin/killswitch` is still reachable with the bearer,
   everything else returns 503 `code: "disabled"`.
3. **Recovery**: flip back to `normal`. The 30-second gate cache means the
   new mode may not be visible to all isolates for up to 30 seconds; the
   admin endpoint calls `gate.invalidate()` so at minimum the operator's own
   isolate refreshes immediately.

## 8. Design validation against industry norms

The killswitch shape was validated against real Cloudflare-hosted precedents
(`littlebearapps/cf-monitor`, the pizzaconsole.com overage-kill post) and
against SRE / circuit-breaker norms (Google SRE "serve degraded results",
GitLab's Maintenance Mode, Azure's circuit-breaker pattern). Concrete
takeaways:

- **Graduated `read_only` → `disabled` is the published norm**, not an
  invented shape. GitLab, Confluence, and Linear all ship this exact
  tiering; Google SRE chapter 22 endorses "serve degraded results" over
  full shed.
- **30-second cache TTL matches Cloudflare KV's own floor** (recently
  lowered from 60s to 30s) and Cloudflare's own Flagship feature-flag
  product uses the same "within seconds" propagation model.
- **N=2 consecutive-miss-to-trip is the Kubernetes readiness-probe norm**
  (liveness uses N=3; readiness — our shape — uses N=2 for faster
  traffic-shedding).
- **Belt-and-suspenders enforcement at HTTP gateway + adapter** is
  recommended practice per the gateway-vs-service-layer analysis in the
  industry literature. Known failure mode: threshold drift between
  layers. Our mitigation: the HTTP middleware and adapter gate both read
  the same `KillswitchMode` enum from the same port, so they cannot
  diverge without a type change.

## 9. Deferred polish tied to this design (M17 / M19)

- **N=2 made env-configurable** — the poller ships in M17; today the
  constant lives in guardrail docs and will move into `wrangler.jsonc`
  vars when the cron handler lands.
- **Read-only UX polish** (M19): persistent top-of-page banner, not a
  dismissible toast; inactive-style write buttons (not `disabled`) per
  GitHub Primer + IBM Carbon accessibility guidance. Koder.ai's
  incident-UX notes show that UI-only disabling is the #1 source of
  leaked writes; the banner + adapter gate combo avoids that class of
  bug.

## 10. What's not covered here

- **Sustained organic growth past the free tier.** The killswitch is for
  runaway bugs and denial-of-wallet attacks, not for scaling. If organic
  usage consistently trips the 70% warning, the operator should either
  upgrade the Cloudflare plan (PAYG + budget alert) or reduce feature usage.
- **Workers KV** — we don't use it. The eventual consistency window (60s)
  is not compatible with killswitch semantics, and we have no other place
  KV would pay for itself.
