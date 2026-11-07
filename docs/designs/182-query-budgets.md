# Design: 182 query budgets

> Plan for a wave lane. Drafted 2026-11-06 from an owner question ("should
> we track how many DB queries, and of what type, a core journey takes?").
> Design 165 already measures speed in production; this is the check
> before production.
>
> **Owner's calls, 2026-11-06:** part 1 covers _every_ list read, not only
> the six first proposed (#484); part 2 is built in wave 3 too (#485). Both
> are wave-3 work, shipped as two PRs: part 1 first, part 2 after the
> lanes changing demo tooling have landed.

## Problem

Nothing notices when a screen starts asking D1 more. Every query is a round
trip from the Worker, D1 runs one query at a time per database (so a slow
screen holds up every other request to it), and D1 bills by rows read.
The likely regression is an N+1: a loader whose query count grows with the
data. Test seeds are a handful of rows, so an N+1 passes every test today
and shows up first for a runner with 60 garments. Timing cannot catch it
before production: e2e runs on a dev server on a shared laptop, and the
numbers are noise. Query counts are deterministic for the same code and
seed, so they can gate a merge.

## Approach

Count queries and rows read **per request** (a route's loader, a server
function), never per journey: a journey's total changes whenever a step is
added and says nothing about which screen moved.

1. **Scaling tests (vitest, `worker` project), the gate.** For each list
   read: the closet, the feed, a runner's runs, G's recent entries, the
   Desk's queues, the bell. Seed 1 row and then 25 of what the list lists,
   call the module read, and assert the query count is **the same**. Rows
   read may grow with the data. Counting extends `test/d1-spy.ts` (design
   143), which already wraps the binding and records each `prepare` and
   `batch`: add a count of statements run, including each statement inside
   a batch, and the `meta.rows_read` sum from each `D1Result`. No
   production code changes, beyond exporting `weather/read.ts`'s two chunk
   sizes so the tests derive their formulas rather than restate them. A read that legitimately scales (one query per
   page of results) asserts its formula, with the reason inline.
2. **Per-route report from the e2e run.** Wave 3, report-only. A dev-only counter in `src/lib/sql/d1-session.ts` tags each
   request's statements with its route id or `serverFn:<id>` (design 165's
   keys), behind an env flag the e2e web server sets. The e2e teardown
   writes route → queries (p50/max) and rows read to the CI step summary,
   beside the a11y coverage line, and compares them with a committed
   `e2e/query-baseline.json`. It starts as a report. Making it fail a run
   (with a tolerance, like `FIGURE_NOISE`) is a later owner call, once a
   few weeks of numbers show how stable it is.
3. **Production: nothing new.** Design 165's tracing shows D1 spans per
   request, and `wrangler d1 insights` ranks queries by rows read on real
   data. `docs/deployment.md` gets one line pointing at the latter.

## Part 2, in detail

The counter lives in the request's D1 scope, the report in the e2e run.
The path, end to end:

1. **The flag.** `VITE_D1_QUERY_TALLY=1`, set in `playwright.config.ts`'s
   `webServer.env`. Vite replaces `import.meta.env.VITE_*` in the
   Worker's code as well as the client's, so the dev server sees it, and
   a production build, made without it, folds the counter away. It is not
   a binding and not `wrangler.jsonc`. One file reads it,
   `src/env/flags.ts` (`isQueryTallyEnabled`), which only server code
   reaches. A production build is made without the flag, so
   `isQueryTallyEnabled()` is the literal `false` there and the counter
   and the header are dead code, not merely off. CI's `preview` matrix
   leg builds without the flag, so only its `dev` leg reports; that is
   enough.
2. **Counting** (`src/lib/sql/d1-session.ts`). `runInD1Scope` takes an
   optional `{ tallyAs: <route> }`: the scope is tallied, under that name,
   only when it is given one. (A bare `{ tally: true }` with the name
   added at the edge was the first draft; it made "tallied" and "named"
   two facts the edge had to check together, and each check alone an
   equivalent mutant.) In a tallied scope, `RoutedDatabase` hands back
   statements that count each run, and each statement inside a batch,
   into the scope, with `meta.rows_read` where D1 gives it. For
   `raw()`/`first()` on a select, which carry no meta, the counter meters
   the select once more with `all()`. That is a second read only on a dev
   server that asked for it, never a second write. The counting statement
   is one Proxy, `src/lib/sql/counted-statement.ts`, which
   `test/d1-spy.ts` now uses too, so the test counter and the dev counter
   cannot count differently. `scopeOutcome()` gains
   `queries: { route, statements, rowsRead } | undefined`. The arithmetic
   is in `src/lib/sql/query-tally.ts`, at 100%.
3. **Out of the Worker.** `respondInD1Scope`
   (`src/modules/auth/d1-request.ts`) adds
   `x-d1-queries: <route>;<statements>;<rowsRead>` to the response when
   the scope was tallied, with the route named as design 165 names it (a
   route id or `serverFn:<id>`, `ops/timing.ts`'s `requestNamer`, passed
   in). The count stops when the `Response` exists, the point design
   165's `ms` stops at too: loaders are in it, and a streamed page's
   deferred data is not. The header's name, format and parse live
   together in `src/lib/query-report.ts`, so writer and reader share one
   definition.
4. **Into the run.** An e2e fixture beside the a11y fixture listens for
   `response` events and writes one line per response carrying the
   header to `test-results/queries/requests.jsonl`:
   `{ route, statements, rowsRead }`.
5. **The report** (`e2e/support/query-report-teardown.ts`, a second entry
   in `globalTeardown`). It reads the lines and groups them by route
   (statements p50/max, rows read p50/max, count). It writes a table to
   `GITHUB_STEP_SUMMARY` under `### D1 queries per request` and compares
   with `e2e/query-baseline.json`, listing the routes whose p50 or max
   statements rose, the new routes, and the ones gone. It never throws:
   report-only. `QUERY_RECORD=1` rewrites the baseline. The header
   parse, grouping, p50/max, diff and table are pure, in
   `src/lib/query-report.ts` (in the ratchet), so `e2e/` holds only file
   and environment glue. A dev server's function id is base64url of its
   file and export, so the report groups by `readableRoute`'s name,
   `serverFn:<module>/<export>` (`serverFn:notifications/bellStateFn`),
   and the baseline's keys are names a reader can follow. Renaming a
   server function shows in the report as one route gone and one new.
6. **The baseline** is recorded once from a full CI-style run, after
   dark-theme merges, since it adds a constant read to signed-in document
   loads.

## Contract touches

- Schema changes needed: **none**.
- New route files: **none**.
- New bindings/queues/crons: **none**. Part 2's flag is a Vite
  `VITE_*` variable, set in `playwright.config.ts`'s `webServer.env`,
  not a binding.
- `.github/workflows/`: **none**. The summary line goes through
  `GITHUB_STEP_SUMMARY`, as the coverage teardown's does.
- `src/lib/sql/d1-session.ts` and `src/modules/auth/d1-request.ts` (part 2
  only) are in the mutation ratchet. The counting lives in
  `src/lib/sql/query-tally.ts` and the report's arithmetic in
  `src/lib/query-report.ts`, both pure and at 100%.

## Test plan

- `test/d1-spy.test.ts` (unit): batch statements count one each; rows read
  sums `meta.rows_read`; a session's statements count like bare ones.
- `test/<module>/*.scaling.test.ts` (worker, one per list read above): 1
  vs 25 rows, equal query counts. Each first passes on main, then fails
  against a deliberately added per-row query (checked once, by hand),
  before it counts as a test.
- Part 2: unit tests for the pure counter (tagging, p50/max, the baseline
  diff); the report checked once against a full CI-style e2e run.

## What part 1 found

Every read a request waits on (route loaders and server functions, plus
the `exportData` consumer; about 45) has a scaling test in a
`test/<module>/*.scaling.test.ts`, 49 in all. Each counts core and weather
apart with `queryCounts` (`test/d1-spy.ts`).

- **Flat**: every closet, products, runs, notifications, onboarding, feed,
  account, ops and safety read except the two below: the same core
  statements for 1 row and 25.
- **Chunked, legitimately**: core IN lists at `IN_LIST_CHUNK` (80); weather
  cache reads at `CELLS_PER_ROW_READ` (20) or `CELLS_PER_READ` (30) cells;
  the Desk's runner list per 80 accounts; `exportData` per 80 entries and
  runs. The tests assert each formula, deriving the constants from source.
- **N+1, open as #490**: the Desk's review queue (9 + 5N statements) and
  takedown requests (2 + 4N), through `otherPhotosOf`, `photoMatchesOf`
  and `removedMatchesOf`. Safety is another lane's, so the tests assert
  today's formula until that lands.
- **Side findings**: `kitsFor`'s IN list sits exactly at D1's
  100-parameter cap (#491); conditions reads do not de-duplicate weather
  cache keys (#492).
- **Out of scope, settled by the owner (#493, 2026-11-07)**: cron and queue
  loops over claimed rows get no scaling tests. They do not carry the
  scaling risk of per-user reads and journeys.

Each test was checked once by hand: a per-row query added to one read per
file made it fail, and reverting made it pass.

## Open questions

Both resolved by the owner, 2026-11-06:

- Which reads count as lists? **Every one**: any read returning rows a
  user, or users together, can grow. The inventory is below.
- Part 2 or not? **Yes, in wave 3**, as its own PR after part 1.
