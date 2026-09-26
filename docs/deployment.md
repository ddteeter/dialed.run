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

Then apply migrations, core first. **`--remote` is not optional**: Wrangler 4
applies D1 migrations to the _local_ database unless told otherwise
(`wrangler d1 migrations apply --help` lists `--local` and `--remote`, and
the package's own local scripts pass `--local` explicitly). Without it the
command succeeds, prints the migrations it applied, and the production
database stays empty.

```sh
wrangler d1 migrations apply dialed-core --remote
wrangler d1 migrations apply dialed-weather --remote
```

Once `docs/proposals/125-ci-migrate-before-deploy.md` is applied, CI runs
exactly these two before every deploy and this step is only for the first.

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

| Bucket           | Binding   | Holds                         | Retention                                                      |
| ---------------- | --------- | ----------------------------- | -------------------------------------------------------------- |
| `dialed-media`   | `MEDIA`   | Garment photos, entry photos  | Indefinite — the app renders these; deleting one breaks a page |
| `dialed-imports` | `IMPORTS` | Uploaded `.fit`/`.gpx`/`.tcx` | **30 days**                                                    |

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

| Schedule     | Handler                                                   |
| ------------ | --------------------------------------------------------- |
| `0 12 * * *` | daily digest (also drains the outbox and re-dispatches)   |
| `0 * * * *`  | weather retry (lane 103)                                  |
| `30 * * * *` | enrichment retry (lane 107)                               |
| `15 * * * *` | screening retry, report reconciliation, stale-claim sweep |

`test/bindings-conformance.test.ts` fails CI if this list and
`src/modules/ops/crons.ts` disagree. After deploying, confirm all four
appear under Workers → dialed → Settings → Triggers.

**Each cron checks in with Sentry Crons** (OPS-3): `in_progress` when it
starts, `ok` or `error` when it ends. The monitors create themselves on
their first firing — the schedule rides on the first check-in — so there is
nothing to set up in Sentry beyond the DSN. One monitor is free on every
Sentry plan; the other three are $0.78 a month each. A monitor that misses
its window raises an issue, which is the only thing that notices a cron
that has stopped firing altogether.

## 5. Secrets

`wrangler secret put <NAME>` for each. None of these belong in
`wrangler.jsonc` — it is committed.

| Secret                        | Required   | Without it                                                                                                                                                    |
| ----------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`          | **yes**    | Auth cannot sign sessions. Use ≥32 random chars (`openssl rand -base64 32`)                                                                                   |
| `VISUAL_CROSSING_API_KEY`     | **yes**    | No weather resolves; every run falls back to manual temp                                                                                                      |
| `STRAVA_CLIENT_ID`            | for Strava | The connect screen renders a "not configured" state                                                                                                           |
| `STRAVA_CLIENT_SECRET`        | for Strava | As above                                                                                                                                                      |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | for Strava | The subscription handshake rejects; pick any long random string and reuse it in step 6                                                                        |
| `SENTRY_DSN`                  | strongly   | Errors go nowhere. This is the only place terminal failures surface for a solo operator                                                                       |
| `GOOGLE_CLIENT_ID`            | optional   | Google sign-in button 500s — set **both** or neither                                                                                                          |
| `GOOGLE_CLIENT_SECRET`        | optional   | As above                                                                                                                                                      |
| `OPENAI_API_KEY`              | **yes**    | Photo screening cannot run, so every photo stays `pending` — **no entry photo is ever publicly visible** — and product extraction stops at the declared rungs |
| `ADMIN_USER_IDS`              | **yes**    | Comma-separated user ids. Unset means nobody is an admin: the Desk and the review queue answer not-found to everyone, the owner included                      |
| `FIRECRAWL_API_KEY`           | optional   | A shop that refuses a Worker (11 of 14 sampled) is a failed fetch, and its product gets no composition                                                        |
| `TURNSTILE_SECRET_KEY`        | **yes**    | Turnstile fails closed: every sign-up and access request is refused, and Sentry says why                                                                      |

**Vars, not secrets** — printed into the page or read as configuration.
These go in a `vars` block in `wrangler.jsonc`, which is human-managed, so
the owner makes the edit:

| Var                  | Value                  | Without it                                                                                                               |
| -------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `BETTER_AUTH_URL`    | `https://<the domain>` | Callbacks resolve against the wrong host, and cookies may lose the `__Secure-` prefix. `/api/health` names it when unset |
| `TURNSTILE_SITE_KEY` | the widget's site key  | The widget renders nothing, and verification refuses                                                                     |

`NODE_ENV=production` was the old answer to Better Auth's rate limiter and
secure cookies (audit finding 0.7). OPS-4 sets both explicitly in
`createAuth`, so once it lands nothing reads `NODE_ENV`; until then, add it
to the same `vars` block.

Locally and in CI, Cloudflare's documented test keys stand in for
Turnstile: site key `1x00000000000000000000AA` and secret
`1x0000000000000000000000000000000AA` always pass.

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
  Cloudflare Workers, plus D1 and R2 read/write on this account. Once the
  CI proposal lands it also applies migrations, which needs D1 edit.
- **Secret `CLOUDFLARE_ACCOUNT_ID`** — `ci.yml`'s deploy step passes it to
  Wrangler alongside the token. Workers → Overview shows it.
- **Variable `DEPLOY_ENABLED=true`** — `ci.yml`'s deploy job is gated on it
  and skips otherwise. It is deliberately opt-in so the first deploy is a
  decision rather than a side effect of a merge. The job is also gated on
  `github.event_name == 'push'`, and `push` only fires for `main`, so no
  pull request can reach it however it is targeted.
- **Branch protection on `main`** — already configured (ruleset "main
  protection"): no deletion, no force-push, PR required, and
  `Lint, typecheck, test, build` + `e2e` + `guardrails` must pass. There are
  no bypass actors, including the owner.

## 8. After the first deploy

- `GET /api/health` — reports per-binding status; expect every check `ok`.
  A failure here names the binding, which is faster than reading a stack.
- Confirm all four cron triggers are listed under Settings → Triggers.
- Confirm the four queues show a consumer attached.
- **Prove Sentry delivers, from a fetch and from a cron**, before relying on
  it to tell you about anything. The two paths end their invocation
  differently, and the audit's finding 0.4 was that a report which does not
  outlive its invocation can be cancelled in flight; OPS-1 hands every send
  to `waitUntil`, and this is where that is checked against the real thing.
  - **Fetch**: `curl -X POST https://<host>/api/strava -d 'not json'`. The
    webhook reports "invalid strava webhook payload" and still answers 200.
  - **Cron**: the first hourly firing after the deploy opens and closes a
    Sentry Crons check-in; seeing `weather-retry` go green under Crons is a
    send from the cron path. For an _error_ from a cron, run the Worker
    locally with the production DSN in `.dev.vars` and fire a schedule it
    does not know: `npx wrangler dev --test-scheduled`, then
    `curl "http://localhost:8787/__scheduled?cron=*/7+*+*+*+*"`. The cron
    reports "unrecognized cron fired".
- **The Sentry alert rule** (deployment plan §5): an issue alert on
  "an event is seen" filtered to the tag `digest = daily`. The digest sends
  one event per anomaly kind, tagged `digest_kind`, and fingerprints it by
  kind and day, so each day's anomalies arrive as a new issue as well.

## 9. Restoring a database (D1 Time Travel)

D1 keeps 30 days of point-in-time history on the Paid plan, with no setup.
A restore is **destructive and in place**: it overwrites the live database.

```sh
# Where the database is now — note the bookmark, so the restore itself
# can be undone.
wrangler d1 time-travel info dialed-core

# Restore to a moment (unix seconds or RFC 3339) or to a bookmark.
wrangler d1 time-travel restore dialed-core --timestamp=2026-10-01T09:00:00Z
wrangler d1 time-travel restore dialed-core --bookmark=<bookmark>
```

**The two databases restore independently, and nothing makes them agree.**
There is no cross-database transaction to rewind to, so decide per
incident:

- **Core only** (a bad write, a bad delete, a bad migration in core) is
  safe on its own. The weather cache is keyed by place and hour, not by
  run, so it stays valid; a band a runner set after the restore point is
  left in `manual_conditions` pointing at a run that no longer exists,
  which nothing reads.
- **Weather only** loses cache rows and bands newer than the restore
  point while core still says `weather_status = 'attached'` or `'manual'`
  for the runs that used them. The retry cron only re-drives `pending`, so
  those runs would show no conditions for good. **Restore weather to the
  same moment as core**, or not at all; a cache row is cheap to fetch
  again, and core's statuses are what decide whether it is.
- **Both, to the same timestamp**, is the default when in doubt.

**`wrangler rollback` does not roll back migrations.** It points traffic at
the previous Worker version and leaves both databases exactly as they are.
That is survivable only because migrations are expand→contract (resilience
law 8): the previous version still runs against the expanded schema. When
the migration itself did damage, restore the database to before it and
then roll the code back. The restore also rewinds `d1_migrations`, so the
same migration applies again on the next `migrations apply` — fix or
remove it before the next deploy.

R2 has no point-in-time history: `MEDIA` is the source of truth for photos,
and a deleted object is gone. Task 126's account-deletion tombstone delays
the purge; nothing else protects R2 yet (a soon-after item).
