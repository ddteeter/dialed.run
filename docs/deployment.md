# First deployment

Everything that has to exist in Cloudflare, GitHub and third parties before
`wrangler deploy` produces a working app, in the order it has to happen.

This is a **runbook, not a checklist of ideas**: every item here is something
the code already expects and will fail without. Anything an agent discovers
that needs a human to create belongs in this file, in the same PR that
introduces the dependency — the same rule as `docs/deferred.md`.

The repo has never been deployed. Nothing below has been done yet, and
`wrangler.jsonc` still carries placeholder D1 ids.

---

## 1. D1 databases

Two, and the code cannot join across them — that separation is load-bearing
(CLAUDE.md §D1 query discipline), not an accident to be tidied up later.

```sh
wrangler d1 create dialed-core
wrangler d1 create dialed-weather
```

Both `database_id` values in `wrangler.jsonc` are placeholder zeros
(`00000000-…-0001`/`-0002`). Replace them with the real ids from the output.
A deploy against the placeholders fails at bind time.

Then apply migrations, core first:

```sh
wrangler d1 migrations apply dialed-core
wrangler d1 migrations apply dialed-weather
```

**Squashing to one baseline is optional, and the reason to do it is
readability, not correctness.** The eleven core migrations are what four
lanes actually did: two of them rebuild a table to change an integer into a
boolean, so the history reads as though someone changed their mind twice.
They replay correctly in order on an empty database — verified — and the
snapshot chain is linear, so `drizzle-kit generate` is happy.

If you want the tidier history, the window is now, while there is no data to
preserve: delete `src/db/migrations/core/`, run
`npm run db:generate:core -- --name=baseline`, and then **re-add
`0002_curated_brand_seed.sql` by hand**. That file is data, not schema —
regenerating from `schema-core.ts` will not reproduce its 50 rows, and
losing them silently breaks brand autocomplete rather than failing a test.

## 2. R2 buckets

Two buckets, split by **retention**, not by cost.

```sh
wrangler r2 bucket create dialed-media
wrangler r2 bucket create dialed-imports
```

| Bucket | Binding | Holds | Retention |
| --- | --- | --- | --- |
| `dialed-media` | `MEDIA` | Garment photos, entry photos | Indefinite — the app renders these; deleting one breaks a page |
| `dialed-imports` | `IMPORTS` | Uploaded `.fit`/`.gpx`/`.tcx` | **30 days** |

**The 30-day rule on `dialed-imports` must be set by hand** — wrangler does
not manage R2 object lifecycle. In the dashboard: R2 → `dialed-imports` →
Settings → Object lifecycle rules → delete objects 30 days after upload.

Why 30 and not forever: an import file has done its job once it is parsed
into a run. The only later use is re-parsing after a parser bug, and a month
covers that. They are also GPS traces — the most sensitive data the product
holds — so keeping them indefinitely is a liability with no product value.

Why not one bucket with a prefix rule: R2 lifecycle rules can be
prefix-scoped, so one bucket would work. Two makes retention a property of
where an object lives rather than a rule someone can misconfigure, and it
stops a photo ever being written to a path that expires.

## 3. Queues

Four: two work queues and their dead-letter queues. `wrangler.jsonc` already
binds all four; they must exist first or the deploy fails.

```sh
wrangler queues create dialed-imports
wrangler queues create dialed-imports-dlq
wrangler queues create dialed-enrichment
wrangler queues create dialed-enrichment-dlq
```

The DLQs are consumed, not just written to — a dead-lettered job has to land
somewhere a human sees it (resilience law 6), which `handleQueueBatch` does
by reporting each to Sentry.

`dialed-enrichment` has no producer yet (lane 107 owns it). It is bound and
consumed so the binding exists before the code that fills it.

## 4. Cron triggers

Declared in `wrangler.jsonc` and created by the deploy itself — nothing to do
by hand. Listed here because they were absent entirely until recently, so both
the daily digest and the weather retry silently never ran.

| Schedule | Handler |
| --- | --- |
| `0 12 * * *` | daily digest |
| `0 * * * *` | weather retry (lane 103) |

`test/bindings-conformance.test.ts` fails CI if this list and
`src/modules/ops/crons.ts` disagree. After deploying, confirm both appear
under Workers → dialed → Settings → Triggers.

## 5. Secrets

`wrangler secret put <NAME>` for each. None of these belong in
`wrangler.jsonc` — it is committed.

| Secret | Required | Without it |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | **yes** | Auth cannot sign sessions. Use ≥32 random chars (`openssl rand -base64 32`) |
| `VISUAL_CROSSING_API_KEY` | **yes** | No weather resolves; every run falls back to manual temp |
| `STRAVA_CLIENT_ID` | for Strava | The connect screen renders a "not configured" state |
| `STRAVA_CLIENT_SECRET` | for Strava | As above |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | for Strava | The subscription handshake rejects; pick any long random string and reuse it in step 6 |
| `SENTRY_DSN` | strongly | Errors go nowhere. This is the only place terminal failures surface for a solo operator |
| `GOOGLE_CLIENT_ID` | optional | Google sign-in button 500s — set **both** or neither |
| `GOOGLE_CLIENT_SECRET` | optional | As above |

Better Auth also warns if it cannot derive a base URL. Set `BETTER_AUTH_URL`
to the deployed origin once the domain is known, or callbacks and redirects
can resolve against the wrong host.

## 6. Strava webhook subscription

Only after the worker is deployed and reachable — Strava validates the
callback synchronously by calling it.

```sh
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=$STRAVA_CLIENT_ID \
  -F client_secret=$STRAVA_CLIENT_SECRET \
  -F callback_url=https://<deployed-host>/api/strava \
  -F verify_token=$STRAVA_WEBHOOK_VERIFY_TOKEN
```

Strava immediately GETs the callback with `hub.challenge`; `verifyStravaChallenge`
echoes it only when mode and token match, so the `verify_token` here must be
byte-identical to the secret in step 5.

Strava allows **one subscription per application**. A staging environment
needs its own Strava app, not a second subscription.

## 7. GitHub

- **Secret `CLOUDFLARE_API_TOKEN`** — the deploy job needs it. Scope: Edit
  Cloudflare Workers, plus D1 and R2 read/write on this account.
- **Variable `DEPLOY_ENABLED=true`** — `ci.yml`'s deploy job is gated on it
  and skips otherwise. It is deliberately opt-in so the first deploy is a
  decision rather than a side effect of a merge.
- **Branch protection on `main`** — already configured (ruleset "main
  protection"): no deletion, no force-push, PR required, and
  `Lint, typecheck, test, build` + `e2e` + `guardrails` must pass. There are
  no bypass actors, including the owner.

## 8. After the first deploy

- `GET /api/health` — reports per-binding status; expect every check `ok`.
  A failure here names the binding, which is faster than reading a stack.
- Confirm both cron triggers are listed under Settings → Triggers.
- Confirm the four queues show a consumer attached.
- Send a test error to Sentry and confirm it arrives, before relying on it
  to tell you about anything.
