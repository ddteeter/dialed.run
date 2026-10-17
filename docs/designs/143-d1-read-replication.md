# Design: 143 D1 read replication

## Problem

D-123 turns on D1 read replication for both databases from launch. A query
only reaches a replica through a D1 session (`withSession`); a bare binding
always reads the primary. Today all 92 `drizzle(env.X)` call sites in 52
files use the bare binding. This work routes request reads through a session
without breaking D-123's consistency rules: a runner never reads older than
their own last write on any device, and a check that authorizes a write
never reads a replica.

## Approach

- **One accessor per database, scoped to the request.** `src/env/d1.ts`
  exports `coreDb()` and `weatherDb()`. Inside a request they return drizzle
  over that request's session; outside one (queue consumers, cron) they
  return the bare binding, so the primary, as today. The scope is an
  `AsyncLocalStorage` (`nodejs_compat` is on), entered by `src/server.ts`'s
  `fetch` around `startFetch`. Every `drizzle(env.X)` becomes an accessor
  call, which also tightens "only `src/env` touches bindings".
- **The session opens lazily**, on the first query. Core opens from the
  newest bookmark known: the `d1b` cookie (this device), and for a signed-in
  runner `user_profiles.d1_bookmark` (every device, plus queue and cron
  writes made for them). The auth gate reads that column in a primary query
  it already makes, so it costs no extra round trip. Weather opens
  `first-unconstrained`, because cron is its only writer.
- **Write-class gates pin the primary.** `verifiedUserId()` is already the
  one gate for writes other runners can see (D-113), and
  `verification-class.test.ts` classifies every function. Calling it
  switches the request to a `first-primary` session, so block, audience and
  ban checks behind it read current data. **Not the request method:** an SSR
  loader calls POST functions inside the page's GET (`terms-gate.ts`, PR
  #140). A `requireUserId()` write that reads _another_ runner's state takes
  an explicit `primaryCoreDb()` instead; the audit below lists them.
- **Auth stays on the primary.** Better Auth's instance keeps the bare
  binding.
- **Bookmarks out.** After the response, `server.ts` sets `d1b` from the
  core session's `getBookmark()` (HttpOnly, Secure, SameSite=Lax, 1 day).
  For a signed-in runner whose request wrote, it stores the bookmark under
  `waitUntil`. The import and export consumers store it for their runner
  after the batch that marks the job done.
- **Drizzle typing:** `drizzle()` accepts `D1Database`, not
  `D1DatabaseSession`. A typed object adapter delegates `prepare` and
  `batch` to the session and rejects `exec`, `dump` and `withSession`. No
  cast.

## Contract touches

- Schema: **one additive nullable column**, `user_profiles.d1_bookmark`
  (`add_profile_d1_bookmark`, numbered past `main` at merge time).
- New route files: none. Bindings, queues and crons: **none**. Replication
  is a dashboard or API switch (`deployment.md` §1).
- Privacy policy: `d1b` joins the cookie list in the same PR.

## Test plan

- worker: accessor outside a request → bare binding; inside → one session
  per request, reused across calls.
- worker: opening constraint from (cookie, stored, both, neither).
- worker: `verifiedUserId()` pins `first-primary`; a pinned request stays
  pinned.
- worker: a write stores the bookmark and a read-only request does not; the
  import and export consumers store it.
- worker: adapter delegates `prepare` and `batch` and rejects the rest.
- architecture: no `drizzle(env.` outside `src/env`.
- production check: log `served_by_primary` / `served_by_region` by request
  kind for the first week of friends use.

## Open questions

1. **Picking the newer of two bookmarks.** Cloudflare says bookmarks are
   ordered but does not document the format. If string comparison is not
   safe, a signed-in runner uses only the stored one. That gives up
   monotonic reads across a device's own requests (rare flicker), not
   read-your-own-writes. To verify in a first spike, along with the adapter.
2. **Audit:** which `requireUserId()` writes read other runners' state
   (handle availability, sharing to `runners`), and whether any GET
   function writes. The list goes here before implementation.
3. **Schema-lag race** (seen in the wild): right after a migration, a
   lagging replica can answer "no such table". Expand→contract covers
   columns. A brand-new table read in its first deploy needs the reader to
   tolerate that, or deploy waits a few seconds after migrating.
