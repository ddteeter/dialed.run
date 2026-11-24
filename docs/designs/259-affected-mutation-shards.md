# Design: 259 affected mutation shards

## Problem

On a PR, the Mutation workflow is about 95% of CI runner time. Every PR that
touches `src/` or `test/` fans out all 43 shards, and most of the lap is
runner-queue time behind that fan-out: a lap's median is 113 minutes with it
and 35 without. 2,092 of 2,968 PR shard jobs ran 25 minutes or less, with
little to re-test. This lane makes a PR run only the shards its diff can
affect (#879, item #5).

## Approach

On `pull_request`, the `scopes` job keeps a shard when:

- **(a)** a changed file is in the shard's scope;
- **(b)** a changed test file is one main's latest report for the shard
  lists as covering or killing a mutant (`coveredBy`, `killedBy`; a deleted
  test counts, a new one no report lists does not, since it can only add
  kills); or
- **(c)** a changed file outside every scope is imported, through any chain,
  by a file in the shard's scope. A report cannot see this case.

A shard is also kept when its report cannot be found or read.

The first version (#981) used the import graph for tests as well: keep the
shard when a file in its scope imports a changed file, or when a changed
test reaches a file in its scope. Module barrels make almost every test
reach almost every scope, so that rule kept nearly everything.

**Every shard runs** when the diff touches the toolchain or the harness:
`package.json`, the lockfile, `.npmrc`, `mise.toml`, `stryker.conf.json`,
`vitest*.config*`, `vite.config.ts`, `tsconfig*`, `wrangler.jsonc`,
`worker-configuration.d.ts`, `.github/workflows/`, `public/`,
`src/db/migrations/`, a file under `test/` that is not a `*.test.ts(x)`
(setup files, helpers, fixtures), the selector, or the scripts that find its
reports. It also runs every shard when the graph cannot answer, for example
a changed file under `src/`, `e2e/` or `scripts/` that the cruise did not
find. For (c), a file with an unresolved local import, an `import(…)` of a
computed path or an executing `import.meta.glob` is treated as importing
everything.

- **The reports** are the ones a shard's seed reads: the newest main push
  run in main's ancestry, red or green, measured under this run's dependency
  digest. `scripts/main-mutation-reports.sh` finds them, and the seed step
  now calls it too, so the checks live in one place: the digest, a regular
  file, readable by jq. One `gh run download --pattern` of the newest
  qualifying run is enough (about 340 MB, 20 s). Main runs are no longer
  cancelled, so it holds every shard's report, and a shard it lacks is kept.
- `scripts/mutation-shards.ts` is the CLI: with no argument it prints every
  shard, and with the diff and the reports folder it prints the kept ones,
  with each one's reason on stderr. `select.ts` holds the decisions,
  `coverage.ts` parses the reports with zod, and `graph.ts` cruises the
  imports with dependency-cruiser, type-only imports left out.
- An empty list skips `mutate`, and `Mutation` passes as it does for a
  docs-only PR. A kept shard that fails still fails it. If the selector
  itself fails, every shard runs.

**Why main stays full.** The push run on `main` is the cold measurement
every PR is seeded from and calibrated against. It ignores the diff and
runs all 43, unchanged.

**What a skipped shard costs.** A PR shard runs `--incremental` from main's
report. That re-tests mutants in changed files and mutants whose covering
test files changed, and trusts the rest: exactly (a) and (b). A skipped
shard would have reproduced its seed. The blind spot is the one incremental
already has: a change to a file outside the scope and outside the tests (a
helper a test uses, a component another scope's test renders) that flips a
kill. Main's cold run catches that, its `main-status` job opens the
"Mutation is red on main" alert, and stop-the-line applies.

**Replay.** The last 44 merged PRs that touched code, against today's graph
and main's reports from run 45217368406:

| rule                | mean shards kept | the 14 PRs no trigger hit |
| ------------------- | ---------------- | ------------------------- |
| import graph (#981) | 39.1 of 43       | 30.9                      |
| coverage (this)     | 34.5 of 43       | 16.1                      |

The other 30 PRs ran every shard: 7 for a migration, 7 for
`stryker.conf.json`, 7 for a test helper, 6 for `package*.json` and 3 for a
workflow.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**. The workflow change is under the
  owner's one-time grant, 2026-11-23.
- Screens implemented: none

## Test plan

- `test/scripts/mutation-shards.node.test.ts` (vitest `node`): on a
  hand-built graph and coverage, (a), (b) for a changed, a deleted and a new
  test, (c), a missing report, the run-everything triggers, the report
  parser, and the CLI on the real repo.
- `test/scripts/mutation-seed.node.test.ts`: the seed through the shared
  script, including a digest mismatch, and the selector's single download.
- `test/architecture/workflow-floor.test.ts`: pins the selection step, its
  reports, the fall-backs and `mutate`'s `relevant` condition.

## Issues

- Relates to #879 (item #5). Not closed: its other four items stay open.

## Open questions

- **Test helpers.** Seven of the 30 PRs that ran every shard did so because
  a test helper changed. Mapping a helper to the specs that import it, and
  those specs to the reports, would take the replay's mean to about 31.
  Worth a follow-up?
