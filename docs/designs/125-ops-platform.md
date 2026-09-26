# Design: 125 Ops & platform

## Problem

The app has to run unattended, and today it cannot say when it is not:
Sentry sends are probably cancelled (0.4), day two of the digest is silent
(0.5), no cron checks in, the auth limiter is off (0.7) and weather bills
24 records to keep one (0.6). This lane fixes that, and builds what other
lanes stand on: the Desk shell (D0), Turnstile, headers, icons, the OG card.

## Approach

- **OPS-1** `ops/sentry.ts`: every Toucan gets `context: { waitUntil }`.
  `waitUntil` is the `cloudflare:workers` export, re-exported by `src/env`
  (the one binding module), so fetch, queue and cron all keep the send alive
  without threading `ctx`. It is a required parameter of `reportException`,
  so the compiler holds every caller to it.
- **OPS-2** the digest groups its checks by **kind** and sends one event per
  kind, fingerprinted `["daily-digest", kind, day]` and tagged
  `digest=daily`, `digest_kind=<kind>`. A new day is a new issue, and the
  tag gives an alert rule something to match every event on.
- **OPS-3 · Sentry Crons**, via Toucan's `captureCheckIn` with a
  `monitorConfig` upsert (monitors create themselves; no dashboard step, no
  new secret, no new vendor). `in_progress` then `ok`/`error` per firing.
  Cost: one monitor is free on every plan; the other three are $0.78/month
  each. The free alternative, healthchecks.io (20 checks free), needs a new
  secret and a new account — owner's veto if $2.34/month is not worth it.
- **OPS-4** (after #104) `instance.ts` passes `BETTER_AUTH_URL`;
  `createAuth` sets `rateLimit { enabled, storage: "database" }` and
  `advanced.useSecureCookies` from the URL's scheme. Migration
  `add_auth_rate_limit` (core, additive). `/api/health` names a missing
  `BETTER_AUTH_URL`.
- **OPS-5** `ops/turnstile.ts`: one `siteverify` POST, 10 s timeout, zod
  parse, fail closed (missing token, missing secret, non-2xx, timeout, bad
  body all refuse). `ui/Turnstile.tsx`: explicit render, token by callback
  and the widget's own hidden input; removed on unmount.
- **OPS-6 · one record per hour-key, not a day per hour-key.** Measured
  against Visual Crossing's docs: a datetime request with `include=current`
  costs **1 record**; a day with hours costs **24**. For a run spanning six
  hour-keys: today 6 × 24 = **144**; storing the whole day = **24** (48 if
  the run crosses midnight); single datetime = **6**. The day only wins if
  four other runs use the same ~1 km cell the same day, which a small app
  will not see. So the adapter asks for the hour (epoch seconds, so the
  zone is unambiguous) with `include=current`. Test: six hour-keys, cold
  cache → six upstream calls, each `include=current` (6 records, not 144).
- **OPS-7** `routes/desk/route.tsx` (shell) + `desk/index.tsx` (Today).
  `ops/desk.ts` holds the gate (a non-admin, signed in or not, gets
  `notFound`, never 403) and `todayCounts()`: reports waiting and the oldest,
  photos the screener could not finish, bans this week and all time. **The
  digest calls the same `todayCounts()`**, so Today and the digest cannot
  disagree (D5). Shell: `data-ground="ink"`, hi-viz for counts that need a
  person, a rail of Today · Review · Duplicates · Gave up · Runners · Access;
  entries whose page does not exist yet render as text, not links.
- **OPS-8** `ops/security-headers.ts`, applied around `startFetch`: CSP
  **report-only** (reports to Sentry's security endpoint, derived from the
  DSN), `frame-ancestors 'none'`, HSTS, Referrer-Policy, Permissions-Policy,
  nosniff. Enforcing needs a script nonce through `router.tsx` (not this
  lane's file), so the policy allows inline scripts until then.
- **OPS-9** `public/` icons + manifest + `robots.txt`; head tags in
  `__root.tsx` after #104 merges (it edits that file).
- **OPS-12/13** docs, plus `docs/proposals/125-ci-migrate-before-deploy.md`.
- **OPS-14** `weather/store.ts` and `read.ts` stop special-casing legacy
  `source='manual'` rows. Dropping `"manual"` from the schema enum is a
  tightened constraint, so it is a question, not a change.
- **OPS-15** after #104 merges. **OPS-11** after 126's ACC-2.
- **OPS-16 · `@cf-wasm/og` 0.5.0**, measured (wrangler 4.129, `deploy
--dry-run` and `wrangler dev`, a card of ~10 text nodes, three fonts):

  | option                  | Worker JS gzip | WASM raw (gzip)      | cold / warm render | verdict                                                         |
  | ----------------------- | -------------- | -------------------- | ------------------ | --------------------------------------------------------------- |
  | `workers-og` 0.0.27     | 147 KB         | 1.46 MB (562 KB)     | 95 / ~30 ms        | logs an init error on every warm hit                            |
  | satori 0.32 + resvg 2.6 | 178 KB         | 2.55 MB (987 KB)     | 100 / ~25 ms       | works, largest                                                  |
  | satori 0.33 (latest)    | —              | + harfbuzz 978 KB    | fails in workerd   | ruled out                                                       |
  | **`@cf-wasm/og` 0.5.0** | **207 KB**     | **1.45 MB (559 KB)** | **84 / ~26 ms**    | **adopted**: same author and wasm pattern as the photon we ship |
  | SVG only                | —              | yoga only            | 39 / ~5 ms         | no social preview takes an SVG                                  |

  The Worker is 6.5 MB raw today; this adds ~2.3 MB raw (~0.8 MB gzip),
  against a 64 MiB uncompressed limit with no compressed limit (Workers
  limits page, checked 2026-09-25), 128 MB memory and 1 s startup. The
  import is lazy, so the wasm compiles on the first card, not per isolate.
  Fonts are vendored static latin WOFF (satori reads no WOFF2), as `.bin`
  so the vite plugin hands over bytes. **Not large, so adopted without
  stopping.** The route is `/og/default`; the entry card is built and
  tested, and 129 wires `/og/entry/$id` to feed's public read
  (`entryCardResponse`, exported from `modules/ops`).

## Contract touches

- Schema: `add_auth_rate_limit` (core, additive, listed for this lane).
- Routes: `desk/route.tsx`, `desk/index.tsx`, `og/*`.
- Bindings/queues/crons: **none**. New secrets (not bindings):
  `TURNSTILE_SECRET_KEY`, var `TURNSTILE_SITE_KEY`, var `BETTER_AUTH_URL`.
- Screens: D0 shell, Today.

## Test plan

Worker: send registered with `waitUntil`; digest events per kind with
fingerprint and tags; check-ins `in_progress` → `ok`/`error` per cron;
Turnstile missing/invalid/expired/timeout refused; six hour-keys → six
1-record calls; `todayCounts` against seeded rows, and the digest reading
it; the Desk gate returns not-found for a non-admin; headers on HTML and on
a photo response. UI: Turnstile widget, Desk shell and Today. e2e:
`e2e/desk/` and a header check.

## Decision log

Owner's answers, 2026-09-26:

- **OPS-3: Sentry Crons, kept** (~$2.34/month past the one free monitor).
- **OPS-14: `'manual'` dropped from `weather_observations.source`.** Task
  129 removes feed's two `ne(source, 'manual')` filters first; the enum
  edit follows, since a drizzle enum without the value no longer
  typechecks against them. `docs/contracts.md` updated here.
- **The CI proposal: approved.** Applied by this lane as its own small PR
  once #104 has merged, exactly the diff in
  `docs/proposals/125-ci-migrate-before-deploy.md`.
- **`wrangler.jsonc` vars: approved** — `TURNSTILE_SITE_KEY` and
  `BETTER_AUTH_URL=https://dialed.run`, with local dev and CI overriding
  `BETTER_AUTH_URL` through `.dev.vars`. Lands with OPS-4 after #104.
  `TURNSTILE_SECRET_KEY` stays with the deployment sweep.
- **The CSP nonce** is not an owner question: it needs `router.tsx`, so it
  is a cross-lane item after #104.

Review of PR #112, applied:

- `/api/health` stays green until OPS-4 wires `BETTER_AUTH_URL`; naming a
  missing var returns in that change.
- Static assets skip the Worker, so `public/_headers` carries the same
  headers (pinned by a test), and the claims say so.
- Share cards are cached on origin + pathname. Cloudflare's docs promise a
  functional Cache API on custom domains and do not promise it on
  workers.dev, so the TTLs are a ceiling on work, not a guarantee.
- "Waiting" has one definition, safety's `pendingReviewCount` (pending
  only); the digest reads it alone, and Today reads it too.
- Turnstile checks the answer's `hostname` (Cloudflare's test key, which
  always answers `example.com` with a testing flag, is let through on the
  flag), and the widget tells the visitor when it cannot run.
- D0 has a conformance spec, waiting on the same CI line as the demo.

## Open questions

None open; see the decision log.
