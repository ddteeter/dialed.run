# Design: 182 query budgets

> Plan for a wave lane. Drafted 2026-11-06 from an owner question ("should
> we track how many DB queries, and of what type, a core journey takes?").
> Design 165 already measures speed in production; this is the check
> before production.

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
   production code changes. A read that legitimately scales (one query per
   page of results) asserts its formula, with the reason inline.
2. **Per-route report from the e2e run.** Later, and report-only at
   first. A dev-only counter in `src/lib/sql/d1-session.ts` tags each
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

## Contract touches

- Schema changes needed: **none**.
- New route files: **none**.
- New bindings/queues/crons: **none**. Part 2's flag is a dev server env
  var, set in `playwright.config.ts`'s `webServer.env`, not a binding.
- `.github/workflows/`: **none**. The summary line goes through
  `GITHUB_STEP_SUMMARY`, as the coverage teardown's does.
- `src/lib/sql/d1-session.ts` (part 2 only) is in the mutation ratchet: the
  counter's tag-and-count logic lives in a pure function beside it, at
  100%.

## Test plan

- `test/d1-spy.test.ts` (unit): batch statements count one each; rows read
  sums `meta.rows_read`; a session's statements count like bare ones.
- `test/<module>/*.scaling.test.ts` (worker, one per list read above): 1
  vs 25 rows, equal query counts. Each first passes on main, then fails
  against a deliberately added per-row query (checked once, by hand),
  before it counts as a test.
- Part 2: unit tests for the pure counter (tagging, p50/max, the baseline
  diff); the report checked once against a full CI-style e2e run.

## Open questions

- Which reads count as lists? Proposed: the six above. The lane greps the
  module indexes for any other read returning an array of rows a user can
  grow.
- Part 2 or not: is a per-route report worth its cost once part 1 covers
  the N+1s? Recommend part 1 this wave, and part 2 only if part 1 turns up
  surprises.
