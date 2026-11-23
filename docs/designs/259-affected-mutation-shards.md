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
- **(b)** a file in the scope transitively imports a changed file, so its
  behaviour, and its mutants' outcomes, can change; or
- **(c)** a changed test file transitively imports a file in the scope, so
  the tests that kill its mutants changed.

**Every shard runs** when the diff touches the toolchain or the harness:
`package.json`, the lockfile, `.npmrc`, `mise.toml`, `stryker.conf.json`,
`vitest*.config*`, `vite.config.ts`, `tsconfig*`, `wrangler.jsonc`,
`worker-configuration.d.ts`, `.github/workflows/`, `public/`,
`src/db/migrations/`, a file under `test/` that is not a `*.test.ts(x)`
(setup files, helpers, fixtures), or the selector itself. It also runs every
shard when the graph cannot answer: a deleted test, a changed file under
`src/`, `test/`, `e2e/` or `scripts/` that the cruise did not find, a local
import it could not resolve, or an `import(…)` or executing
`import.meta.glob` (one without `?raw`) that no resolver follows. A file
outside those roots that is none of the above (docs, design, `.claude/`)
keeps nothing.

- `scripts/mutation-shards.ts` is the CLI: with no argument it prints every
  shard, and with a `git diff --name-status --no-renames` file it prints the
  kept ones, with each one's reason on stderr.
- `scripts/mutation-shards/select.ts` holds the decisions, pure and tested.
  The shard name and slug move into it from the workflow's inline
  `node -p`, so there is still one copy.
- `scripts/mutation-shards/graph.ts` cruises `src`, `test`, `e2e` and
  `scripts` with dependency-cruiser's API (as `scripts/diagrams/sources.ts`
  does) and reads computed imports with `scripts/diagrams/syntax.ts`.
  Type-only imports are left out: they run nothing.
- `scopes` gains `setup-node` and `npm ci`. An empty list sets
  `relevant=false`, so `mutate` is skipped and `Mutation` passes as it does
  for a docs-only PR; a kept shard that fails still fails it. If the
  selector itself fails, the step warns and runs every shard.

**Why main stays full.** The push run on `main` is the cold measurement
every PR is seeded from and calibrated against. It ignores the diff and
runs all 43, unchanged.

**What a skipped shard costs.** A PR shard runs `--incremental` from main's
report, which re-tests mutants in changed files and mutants whose covering
test files changed, and trusts the rest. Those are (a) and (c), so a shard
this skips would mostly have reproduced its seed. (b) is kept anyway: a
cold run would see it. The blind spot is the one incremental already has, a
change to a file outside the scope and outside the tests (a helper a test
uses, a component another scope's test renders) that flips a kill. Main's
cold run catches that, its `main-status` job opens the "Mutation is red on
main" alert, and stop-the-line applies.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**. The workflow change is under the
  owner's one-time grant, 2026-11-23.
- Screens implemented: none

## Test plan

- `test/scripts/mutation-shards.node.test.ts` (vitest `node`: TypeScript
  and dependency-cruiser cannot load in workerd), on a hand-built graph: a
  src change keeps its shard and its importers' shards; a test-only change
  keeps the shards it reaches; `package.json` keeps all; docs keep none; an
  unresolvable file keeps all; plus the other fall-backs, and the names and
  slugs the workflow has always used. One case runs the CLI on the real
  repo.
- `test/architecture/workflow-floor.test.ts`: pins the selection step, the
  fall-back to every shard, and `mutate`'s `relevant` condition.

## Issues

- Relates to #879 (item #5). Not closed: its other four items stay open.

## Open questions

- **The saving is small.** Replaying the last 44 merged PRs that touched
  code against today's graph, this rule kept 39 of 43 shards on average:
  module barrels make almost every test reach almost every scope, and a
  third of those PRs changed `stryker.conf.json`, a migration or a test
  helper. Dropping (b) changes little. A narrower rule would read which
  test files cover each shard's mutants from main's seed reports
  (`coveredBy`), which is exactly what `--incremental` re-tests. Worth a
  follow-up?
