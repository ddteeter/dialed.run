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
wrangler r2 bucket create dialed-guides
```

| Bucket           | Binding                | Holds                                                  | Retention                                                                                                                             |
| ---------------- | ---------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `dialed-media`   | `MEDIA`                | Garment photos, entry photos                           | Indefinite — the app renders these; deleting one breaks a page                                                                        |
| `dialed-imports` | `IMPORTS`              | Uploaded `.fit`/`.gpx`/`.tcx`; data export ZIPs        | Run files: **until the run or account is deleted** (D-110); a file whose import failed, 30 days. Export ZIPs under `exports/`: 8 days |
| `dialed-guides`  | (R-134, not yet bound) | `guide-artifact/v1.json`, the nightly anonymous totals | Overwritten nightly; read by the marketing site's CI with a read-only token scoped to this bucket                                     |

**No rule expires a run file** (decision D-110). An uploaded file is kept
for as long as its run: deleting a run deletes its file (feed's `deleteRuns`,
through the outbox's `import_file_delete`), and deleting an account deletes
everything under `imports/<user>/` (the purge lists the prefix). A file
whose import failed has no run, so the batch that fails the import owes its
deletion 30 days later (outbox `import_file_expire`, owner 2026-10-04), and
the daily digest's drain deletes it — in code, not a bucket rule. A bucket
whose whole-bucket 30-day rule is still set from before D-110 must have it
**removed** — it would delete files the runner was promised we keep.

**One rule on the bucket, for data exports only, set by hand** (decision
D-85) — wrangler does not manage R2 object lifecycle. In the dashboard: R2 →
`dialed-imports` → Settings → Object lifecycle rules → prefix `exports/`,
delete objects **8 days** after upload. Task 126's
emailed ZIPs are staged there (`exports/<user>/<export>/<claim>.zip`) and
the hourly sweep deletes each once its 7-day link expires; this rule is the
net behind it, for a ZIP a build left under a claim no row holds (it died
between its upload and marking the export ready). Eight is past the
seven-day link, so the rule never takes a live export.

Why kept, not expired (D-110, which replaced a 30-day rule): expiry cannot
be undone, and the file is what lets a new field be re-parsed from an old run
(D-111's moving time and elevation) and leaves routes and maps possible later
(R-132). They are GPS traces — the most sensitive data the product holds — so
they go the moment the runner deletes the run or the account, by the deletion
paths and not by a rule someone has to remember to set.

Why not one bucket with a prefix rule: R2 lifecycle rules can be
prefix-scoped, so one bucket would work. Two makes retention a property of
where an object lives rather than a rule someone can misconfigure, and it
stops a photo ever being written to a path that expires.

## 3. Queues

Six: three work queues and their dead-letter queues. `wrangler.jsonc` already
binds all six; they must exist first or the deploy fails.

```sh
wrangler queues create dialed-imports
wrangler queues create dialed-imports-dlq
wrangler queues create dialed-enrichment
wrangler queues create dialed-enrichment-dlq
wrangler queues create dialed-exports
wrangler queues create dialed-exports-dlq
```

`dialed-exports` (task 126, decision D-86) carries the emailed data
export, one ZIP build a delivery (`max_batch_size: 1`). Create it and its
DLQ **before the first deploy that binds them** — any deploy of PR #132 or
later.

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

| Secret                        | Required   | Without it                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`          | **yes**    | Auth cannot sign sessions. Use ≥32 random chars (`openssl rand -base64 32`)                                                                                                                                                                                                                       |
| `VISUAL_CROSSING_API_KEY`     | **yes**    | No weather resolves; every run falls back to manual temp                                                                                                                                                                                                                                          |
| `STRAVA_CLIENT_ID`            | for Strava | The connect screen renders a "not configured" state                                                                                                                                                                                                                                               |
| `STRAVA_CLIENT_SECRET`        | for Strava | As above                                                                                                                                                                                                                                                                                          |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | for Strava | The subscription handshake rejects; pick any long random string and reuse it in step 6                                                                                                                                                                                                            |
| `SENTRY_DSN`                  | strongly   | Errors go nowhere. This is the only place terminal failures surface for a solo operator                                                                                                                                                                                                           |
| `GOOGLE_CLIENT_ID`            | optional   | Google sign-in button 500s — set **both** or neither                                                                                                                                                                                                                                              |
| `GOOGLE_CLIENT_SECRET`        | optional   | As above                                                                                                                                                                                                                                                                                          |
| `OPENAI_API_KEY`              | **yes**    | Photo screening cannot run, so every photo stays `pending` — **no entry photo is ever publicly visible** — product extraction stops at the declared rungs, and handle screening falls back to the word list alone: every handle claimed is stored `unknown` and the hourly re-ask waits for a key |
| `ADMIN_USER_IDS`              | **yes**    | Comma-separated user ids. Unset means nobody is an admin: the Desk and the review queue answer not-found to everyone, the owner included                                                                                                                                                          |
| `FIRECRAWL_API_KEY`           | optional   | A shop that refuses a Worker (11 of 14 sampled) is a failed fetch, and its product gets no composition                                                                                                                                                                                            |
| `TURNSTILE_SECRET_KEY`        | **yes**    | Turnstile fails closed: every sign-up and access request is refused, and Sentry says why                                                                                                                                                                                                          |
| `UNSUBSCRIBE_SECRET`          | **yes**    | Signs unsubscribe links (its own secret, not the auth one). Fails closed: no optional email goes, every link is refused, and `/api/health` names it                                                                                                                                               |

**Vars, not secrets** — printed into the page or read as configuration.
They live in `wrangler.jsonc`'s `vars` block (owner-approved, 2026-09-26),
which `test/bindings-conformance.test.ts` checks:

| Var                  | Value                                      | Without it                                                                                                                                           |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_URL`    | `https://dialed.run` (set)                 | Callbacks resolve against the wrong host; secure cookies and rate limiting are off (both follow its https scheme). `/api/health` names it when unset |
| `TURNSTILE_SITE_KEY` | empty until the widget exists — **set it** | The widget renders nothing, and verification refuses                                                                                                 |

**Local dev and CI override `BETTER_AUTH_URL`** in `.dev.vars`
(`http://localhost:<port>`; CI's e2e job writes `http://localhost:3000`).
Without the override, local sign-in fails on Better Auth's origin check —
every cookie-bearing POST from `localhost` is refused 403
`INVALID_ORIGIN`, since the configured origin is `https://dialed.run` —
and the https posture turns the rate limiter on, which e2e's many
sign-ups from one address would trip. (Not the `__Secure-` cookie:
Chromium accepts that on `localhost`.) **Every existing checkout needs the
line added to its `.dev.vars`.**

**Attach `dialed.run` to the Worker before the first deploy** (the
`routes` / `custom_domain` step), or set `BETTER_AUTH_URL` to the
workers.dev origin until it is. `wrangler.jsonc` ships
`BETTER_AUTH_URL=https://dialed.run`, and with it set Better Auth trusts
only that origin: on any other host every cookie-bearing POST (sign-in,
sign-up, sign-out) is refused 403 `INVALID_ORIGIN`, and OAuth
`redirect_uri`s point at `dialed.run`. The CI deploy job is named "Deploy
to workers.dev"; its target changes with the domain step.

`NODE_ENV` is not needed: OPS-4 sets Better Auth's rate limiter and secure
cookies explicitly from `BETTER_AUTH_URL`'s scheme (audit finding 0.7).

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

- `GET /api/health` — reports per-binding status; expect every check `ok`
  and `missing` empty. A failure here names the binding, and `missing`
  names any required var by its own name (today, `BETTER_AUTH_URL` and
  `UNSUBSCRIBE_SECRET`), which
  is faster than reading a stack. Either makes it answer 503.
- Confirm all four cron triggers are listed under Settings → Triggers.
- Confirm the six queues show a consumer attached.
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
- **Every alert rule filters `environment:production`.** Each event and
  check-in is tagged `production` only when `BETTER_AUTH_URL` is the
  production origin, and `development` otherwise, so a local or CI run
  holding a real DSN cannot page you.

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

R2 has no point-in-time history; see §10 for what that costs.

## 10. R2 has no backup

R2 keeps no versions and has no Time Travel. An object deleted or
overwritten is gone, and so is a bucket someone deletes. Nothing in this
app copies either bucket anywhere today. Task 126's account-deletion
tombstone delays a purge by seven days, which protects against a bad
account deletion and nothing else.

**What is in `dialed-media` (`MEDIA`), by key prefix, and what losing it
costs:**

| Prefix                               | What                                                                            | If it is lost                                                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `items/<user>/<item>/…`              | Garment photos (the original and its variants)                                  | **Unrecoverable.** The garment rows survive in D1 with a `photo_key` pointing at nothing, so the closet shows a garment with no photo. Only the runner has the original. |
| `entries/<user>/<entry>/<photo>`     | Entry photos                                                                    | **Unrecoverable**, the same way: the entry, its kit and verdict survive, and the photo is a missing image.                                                               |
| `quarantine/entries/…`               | Photos copied aside by a suspected-CSAM quarantine, preserved for a year (D-70) | **Unrecoverable, and the worst one.** The original was deleted in the same step, so this copy is the only one, and the year's preservation D-70 promises is broken.      |
| `products/<product>/snapshot-*.html` | The product page enrichment fetched                                             | Re-fetchable. The extracted fields are already in D1; a lost snapshot only means re-running extraction has to fetch the page again.                                      |
| `products/<product>/image-*`         | Product images enrichment fetched                                               | Re-fetchable by re-running enrichment for the product.                                                                                                                   |
| `health-probe`                       | `/api/health`'s probe (a `head`, never written)                                 | Nothing.                                                                                                                                                                 |

**`dialed-imports` (`IMPORTS`)** holds uploaded `.fit`/`.gpx`/`.tcx` files
under `imports/<user>/<import>.<ext>`, for as long as the run (§2, D-110),
and deletes a file when its run or account is deleted. The run itself is in
D1, so losing the bucket loses imports still waiting in the queue, which
fail and dead-letter (the runner sees that import failed and can upload the
file again), and the originals of runs already parsed — which cost the
re-parse D-110 keeps them for, never a run. **It does not need a backup**:
a copy of GPS traces somewhere else is a copy the deletion paths cannot
reach.

**A D1 restore does not bring R2 back with it.** Restoring core to before
a photo was removed brings back a row whose object the reconcile has
already deleted: the same missing image as above. There is nothing to
reconcile it against.

**The options, cheapest first.** None is built. The first needs nothing;
the other two need a binding or a workflow, which are the owner's.

1. **Accept it until public launch.** Before friends, the photos are few
   and their owners still have them; everything else a runner logged is in
   D1 and covered by Time Travel. Say so to the friends cohort. The one
   prefix this is weakest for is `quarantine/`.
2. **A second bucket, copied into by a cron.** A `dialed-media-backup`
   bucket the app only ever writes to, never deletes from, filled by the
   daily cron copying objects uploaded since its last run (R2's `list`
   returns each object's upload time; `cron_checkpoints` already holds
   "since when"). Costs a second copy of storage (R2 standard storage is
   priced per GB-month; check the current rate on Cloudflare's R2 pricing
   page) and one write per object. It covers a bad delete or overwrite by
   the app. It does not cover losing the Cloudflare account. Needs a new
   R2 binding in `wrangler.jsonc` and a line in
   `test/bindings-conformance.test.ts`.
3. **A copy off Cloudflare.** R2 speaks the S3 API, so `rclone sync` with a
   read-only R2 API token can copy `dialed-media` to another provider on a
   schedule: a GitHub Actions workflow, or any machine that runs cron. This
   is the only option that survives losing the account, and it keeps
   runners' photos with a second processor, which the privacy policy would
   have to name. Needs a new secret and a workflow file.

For `quarantine/` specifically, R2 **bucket locks** (retention rules that
refuse deletion for a set period, by prefix) may fit better than a copy.
Confirm on the R2 docs that they cover this case before relying on it:
they are newer than the rest of this runbook.

**Recommendation:** option 1 for the friends cohort, and either 2 or 3
before public launch. 3 if losing the account is a risk worth paying for,
2 if not.
