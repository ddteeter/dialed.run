# Design: 165 Performance monitoring

## Problem

Nothing measures speed. Sentry gets server errors and cron check-ins only:
no tracing, no browser SDK. Nobody can answer "how long does the closet
take to appear on a phone" or "did last week's deploy make the feed
slower". The owner wants per-screen numbers that scale without a redesign,
and wants them collecting before friends arrive, because a baseline cannot
be backfilled.

## Approach

Three parts. All three group by the TanStack **route id**
(`/runs/$runId`), never by URL, so `/runs/abc` and `/runs/def` count as
one screen.

1. **Browser vitals → Workers Analytics Engine.** The client loads
   `web-vitals` (attribution build) and sends LCP, INP, CLS, FCP and TTFB.
   It also sends a custom `nav` metric: the time from a client-side
   navigation starting to the router's `onRendered`, keyed by the
   destination route. `web-vitals` only measures hard loads, and after the
   first page this app navigates client-side, so `nav` is the real "wait
   time". Each page lifecycle sends one `sendBeacon` to `POST /api/vitals`
   on `visibilitychange: hidden`. That endpoint validates the payload and
   writes one data point per metric to the `VITALS` dataset.
2. **Server timing → Workers Logs.** `server.ts` logs one JSON line per
   request: `{kind:"timing", route, method, status, ms}`. `ms` is the time
   until the `Response` exists, which is the time to first byte. A
   streamed body runs longer, and the invocation's own wall time already
   covers that. Server functions log as `serverFn:<id>`. Workers Logs
   indexes JSON fields, so the Query Builder and Custom Dashboards can
   chart p50/p95 per route with no new binding.
3. **Workers tracing on** (`observability.traces`). Per-request spans show
   where server time goes: D1, R2, fetches. This is an owner edit to
   `wrangler.jsonc`. It reverses the deployment plan's "tracing off",
   which was written before the 2026-12-01 pricing (50 GB of ingest
   included on Workers Paid).

**Data-point layout** (`VITALS`):

- index1: route id
- blobs: metric, navigation type, device (`narrow` below 768px, `wide`
  otherwise), deploy version (stamped by the server)
- doubles: value, then up to four attribution sub-parts. LCP: TTFB, load
  delay, load time, render delay. INP: input delay, processing time,
  presentation delay.

There is no account, session, URL, query string, IP, user agent or
element selector. Queries must weight by `_sample_interval`, because
Analytics Engine samples at volume. `docs/deployment.md` gains the example
queries.

**Ingest endpoint** (`src/routes/api/vitals.ts` is glue; the logic is
`src/modules/ops/vitals.ts`). It is public, so:

- it refuses bodies over 4 KB before parsing;
- it requires `Sec-Fetch-Site: same-origin`;
- it parses with zod: at most 20 metrics, each name from an enum, each
  value finite and inside a per-metric range;
- it checks the route id's shape (see Deltas);
- it is rate-limited at the zone: `/api/vitals` joins the WAF
  rate-limiting rules in `deployment-plan.md` §7. That needs no binding,
  and the Worker never sees the IP;
- it answers 204 whatever happens, so a probe learns nothing. A rejected
  payload is counted in a log line, never stored.

**Retention rollup.** Analytics Engine keeps about 3 months of data. The
daily firing reads yesterday's p50/p75/p95 and count per route, metric and
device through the SQL API, then upserts them into a new core table,
`perf_daily`. Re-running a day overwrites its rows (law 1). The run has a
Sentry Crons monitor already, because it rides the existing daily cron.

**Detection** (`src/modules/ops/perf-checks.ts`). Every check is pure
over query results, needs at least `MIN_N` samples per route and metric
(default 30), and stays silent below that. Each check runs on its own, so
one failure doesn't stop the rest (the design 162 shape).

- **Daily, after the rollup:** yesterday's p75 per route is checked
  against fixed limits (LCP 2.5 s, INP 200 ms, CLS 0.1, `nav` 1 s, server
  p95 1 s) and against its own 7-day median (more than 25% worse). A
  breach is a `digest: daily` event, which the existing every-event rule
  emails.
- **Hourly, on the `:30` firing (no new cron):**
  - _Deploy regression_: the newest deploy version's p75 per route against
    the previous version's, once both pass `MIN_N`.
  - _Drift_: the last 3 hours against the same hours of the week over the
    past 4 weeks, breaching when the value is above the median + 3 × MAD
    in two windows in a row.

  These are reported as `digest: hourly` events, fingerprinted
  `["perf", check, route, metric, day]`, so each regression is its own
  issue and alerts once a day.

**Dashboards** (owner checklist in `deployment.md` §8):

- A Cloudflare Custom Dashboard, "Performance", built from saved Query
  Builder queries: server p50/p95 by route, and 5xx by route.
- A Grafana Cloud (free tier, ClickHouse plugin) dashboard over `VITALS`.
  Its JSON is committed at `docs/ops/grafana-vitals.json` and imported
  rather than built by hand. Its queries and the detector's come from one
  file, `src/modules/ops/vitals-queries.ts`, and a test pins the JSON to
  that file.

**Privacy text** (owner approves the wording; nobody has accepted v1 yet):

- `privacy-policy.md:57`, replacing "The app runs no analytics":
  _"The app measures its own speed: how long each kind of screen takes to
  load and respond, with your screen size (narrow or wide). Never your
  account, the page address or anything you entered. It runs no other
  analytics; the marketing site counts page views without cookies."_
- Cloudflare's processor row adds "speed measurements" to its purpose.
- `docs/launch/compliance/ropa.md` gains the matching row.

## Contract touches

- Schema: **`perf_daily`** (core): `day`, `route`, `metric`, `device`,
  `p50`, `p75`, `p95`, `n`; primary key on the first four. Additive.
- New route file: `src/routes/api/vitals.ts`
- **New bindings (owner, `wrangler.jsonc`)**:
  - `analytics_engine_datasets` with `VITALS`, dataset `dialed_vitals`;
  - `version_metadata` with `CF_VERSION_METADATA`, for the deploy version;
  - `observability.traces.enabled`.
- **Zone (owner)**: a WAF rate-limiting rule for `/api/vitals`, 60 a
  minute per IP.
- **New secret**: `ANALYTICS_SQL_TOKEN`, an account token with Account
  Analytics Read, for the rollup. It goes in `deployment.md` §5,
  `deployment-plan.md` §2 and `.dev.vars.example`.
- New dependency: `web-vitals` (MIT, about 2 KB attribution build).
  `check:bundle` and the open-source list pick it up.
- CSP: unchanged. The beacon is same-origin.
- `docs/architecture.md`: add the dataset and the ingest flow to the
  diagram.

## Steps

Each step is one commit and passes the commit gate.

1. **Route ids.** Add `routeIds()` (derived from `routeTree`) and
   `routeIdFor(pathname)` for the server log. Unit tests pin both against
   the tree. Done when every file route resolves and `/runs/x` gives
   `/runs/$runId`.
2. **Server timing log.** Add `timingLine()` in `ops`, wired in
   `server.ts`. Worker tests cover the line's shape, status, and the
   serverFn naming. Done when a dev request prints the line.
3. **Ingest parser.** Add `vitalsPayloadSchema` and `toDataPoints()`,
   which are pure. Tests cover every bound, the enum, the unknown route,
   20 vs 21 metrics, and the absence of any other field.
4. **Ingest endpoint.** Add the size cap, the origin check and the 204,
   with worker tests against the binding. Extend `bindings-conformance` to
   cover `VITALS` (law 10). _Blocked on the owner's binding edit._
5. **Client reporter.** `lib/browser/vitals.ts` collects metrics, adds the
   router `nav` timing, and sends one beacon on hide. It is wired in
   `__root.tsx`. UI tests use fake `web-vitals` callbacks and a stubbed
   `sendBeacon`. One browser test runs a real load and checks that a
   payload passes `vitalsPayloadSchema`. `npm run build` stays green.
6. **Rollup.** Add the `perf_daily` migration and `rollupVitals(day)` on
   the daily firing, with a zod-parsed SQL API response and a timeout
   (law 4). Worker tests check that a re-run is idempotent and that an API
   failure reports without failing the other digest checks.
7. **Daily checks.** Add the fixed-limit and 7-day-median checks over
   `perf_daily`. Tests cover each limit at its exact boundary, the
   behaviour below `MIN_N`, isolation from the other checks, and the event
   tags.
8. **Hourly checks.** Add deploy regression and drift on the `:30`
   firing. Tests use synthetic series for a clean regression, a single
   noisy window (silent), two windows in a row (fires), too few samples
   (silent), and a first deploy with no previous version (silent).
9. **Dashboards.** Add `vitals-queries.ts`, the Grafana JSON, the test
   that pins one to the other, and the saved-query list for the
   Cloudflare dashboard.
10. **Docs and text.** Update the privacy policy, ropa, the architecture
    diagram, the deployment checklists (secret, binding, WAF rule, the
    tracing line, the dashboard setup in §8), and the example queries in
    `deployment.md`.

## Deltas

Recorded as the build found them.

- **The route id's shape is checked, not whether it exists.** The real list
  can only be read where `routeTree` is, which is `server.ts`, and the
  endpoint is a route. An existence check would also not stop the abuse
  that matters: a forged slow value for a real route. The WAF rate limit
  and the detector's `MIN_N` are the defence.
- **No rating blob.** A rating (good / poor) follows from the value and
  the thresholds, so the queries derive it rather than store a second
  copy.
- **The deploy version is the server's**, from a `version_metadata`
  binding, never the client's claim. A tab left open across a deploy
  reports for the new version for a few minutes; that is accepted.
- **Server functions log as `serverFn:<hash>`.** In production TanStack
  names a server function by a sha256 of its file and export. A readable
  name would need `generateFunctionId` in `vite.config.ts`, which is
  human-managed.
- **The matcher found a bug of its own design:** an exact route must beat
  a splat that matches it with nothing left over (`/feed` over `/feed/$`).
- **A route id is at most 96 characters,** not 120. It becomes the data
  point's index, and Analytics Engine drops a point whose index is over
  96 bytes. The longest real id is 29.
- **Refusals are logged by reason** (`cross-site`, `too-large`,
  `not-json`, `invalid`, `unreadable` for a body that broke mid-read,
  `write-failed`). Only `write-failed` goes to Sentry, because only it is
  ours to fix.
- **The capped body reader moved to `src/lib/read-capped.ts`.**
  Enrichment's `readCapped` had it first. The beacon needed the same
  loop, and two copies would be a clone. Enrichment keeps its wrapper and
  its error messages.
- **The bindings went in on 2026-10-31,** by the owner's leave, in this
  branch. The test pool binds them too, and `bindings-conformance` pins
  both configs and the one module that reads them.

## Test plan

Covered per step above. Mutation ratchet: everything outside
`src/routes/` stays at 100%.

## Open questions

1. **Cloudflare Web Analytics: skip it** (this changes the earlier
   recommendation). With the attribution build, part 1 already has the
   LCP and INP sub-parts per route. Web Analytics would add page-view and
   referrer counting, which really is analytics, plus a third-party script
   on every page and two CSP hosts. Proceeding on skip unless vetoed.
2. **Region.** Should data points carry the continent (from
   `request.cf`)? It is useful for latency, but it is one more field in
   the policy. Proceeding on _no_.
3. **Where rollups are viewed.** Grafana covers the live 3 months.
   Proceeding on a `perf_daily` table on the Desk as a follow-up, not in
   this plan.
4. **Thresholds.** `MIN_N` = 30, 25% for the daily check, and 3 × MAD for
   two windows in a row are starting values, set in one constants block.
   Expect to tune them once real traffic exists.
5. **Trace contents.** I need to verify whether automatic D1 spans record
   SQL text and bound values before tracing is enabled (step 7 checks it
   in dev). If they record values, traces need `persist: false` or a
   policy line.
