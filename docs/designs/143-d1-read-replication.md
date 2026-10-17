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
  runner `user_profiles.d1_bookmark` (every device). `requireUserId()` and
  `verifiedUserId()` read that column in the batch they already send, so it
  costs no round trip; signed-out and `optionalUserId()` pages use the
  cookie alone. Weather opens
  `first-unconstrained`, because cron is its only writer.
- **Write-class gates pin the primary.** `verifiedUserId()` is already the
  one gate for writes other runners can see (D-113), and
  `verification-class.test.ts` classifies every function. Calling it
  switches the request to a `first-primary` session, so block, audience and
  ban checks behind it read current data. **Not the request method:** an SSR
  loader calls POST functions inside the page's GET (`terms-gate.ts`, PR
  #140). A `requireUserId()` write that reads _another_ runner's state takes
  an explicit `primaryCoreDb()` instead; the audit below lists them.
- **Auth stays on the primary.** `primaryCoreDb()` is, inside a request,
  a `first-primary` session of its own, so Better Auth's writes leave a
  bookmark that the replica session starts from and the cookie carries.
  **Handles decide per query, not when made**: Better Auth's instance is
  built at module load, outside any request.
- **Bookmarks out.** After the response, `server.ts` sets `d1b` from the
  core session's `getBookmark()` (HttpOnly, Secure, SameSite=Lax, 1 day).
  For a signed-in runner whose request wrote, it stores the bookmark under
  `waitUntil`. A write is seen at `prepare` (`insert`/`update`/`delete`/
  `replace`), because locally every query, read or write, advances the
  bookmark. Queue and cron writes made for a runner are **not** stored
  (changed in implementation): the replica catches up in tens of
  milliseconds, far sooner than a runner opens the finished import or
  export.
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
- worker: a write stores the bookmark and a read-only request does not.
- worker: adapter delegates `prepare` and `batch` and rejects the rest.
- architecture (`d1-access.test.ts`): no `drizzle(env.` or `.withSession(`
  outside `src/env/d1.ts` and the session module.
- production check: the D1 dashboard's per-region metrics during the
  friends launch, to confirm replicas serve reads.

## Resolved before implementation

1. **Bookmark order (spike).** Local bookmarks are four fixed-width,
   zero-padded hex groups (`00000000-0000003d-00000000-<32 hex>`), so
   string order is issue order. `newerBookmark` compares strings, and
   `parseBookmark` rejects anything that is not hex, so a production
   format change degrades to "no bookmark", never a thrown request. The
   adapter type-checks with no cast and runs `batch`.
2. **Audit.** Primary for: the closet's link denylist (`safety/denylist`),
   the takedown and request-access abuse limits, and the weather-cache
   reads in attach and manual bands (`pinPrimary("weather")`). Already
   safe: the username claim (re-checked inside its write batch), products
   (read after the session's own write). No GET server function writes.
   The loader-called POST writers are own-row writes.
3. **Schema-lag race** (seen in the wild): right after a migration, a
   lagging replica can answer "no such table". Expand→contract covers
   columns; a brand-new table read in its first deploy must tolerate it, or
   the deploy waits a few seconds after migrating. Open, for the deploy
   runbook.
