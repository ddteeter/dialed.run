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
   production code changes. A read that legitimately scales (one query per
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

Both resolved by the owner, 2026-11-06:

- Which reads count as lists? **Every one**: any read returning rows a
  user, or users together, can grow. The inventory is below.
- Part 2 or not? **Yes, in wave 3**, as its own PR after part 1.
