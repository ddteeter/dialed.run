# Design: 199 hook timeouts

## Problem

The `lib/contracts/thermal` Mutation shard's dry run failed twice on PR #572
with `Hook timed out in 10000ms` in `test/feed/run-span.test.ts`, and passed
on re-run each time (#566, fourth item). A failed dry run fails the shard
before one mutant runs.

## Approach

**What was measured.** The failing hook is the file's `beforeEach`, the feed
tables' reset (`resetTables`).

- Alone, the hook and all seven tests take about 50 ms together.
- The file alone, four runs with 40 CPU-bound processes on 10 cores: no
  timeout. The run stretched from 4 s to 35 s; the tests stayed at 50 ms.
- Stryker's dry run for the thermal entry, three runs with 20 CPU-bound
  processes: no hook or test timeout (598 s, 682 s, 627 s; the CI run that
  failed took 4 min 23 s).

**Not reproduced.** The setup is not slow, so batching the reset's deletes
would save milliseconds and is not done. CPU starvation alone did not stall
the hook for 10 s here; what did on the CI runner is not known. #579 watches
for it.

**The guard.** `vitest.config.ts` sets `testTimeout` to 20 s, and 60 s under
Stryker (`TEST_TIMEOUT_MS`, owner's call 2026-09-25, for a starved harness
failing a different test each run). It set no `hookTimeout`, so hooks kept
vitest's default 10 s: half a test's deadline, and a sixth of it under
Stryker. Each of the three projects now sets `hookTimeout: TEST_TIMEOUT_MS`.
A 12 s hook fails without the change (`Hook timed out in 10000ms`) and
passes with it.

**Seed cost: none.** The local incremental cache's fingerprint is the
Stryker version, `stryker.conf.json` and the lockfile; the CI seed key is the
shard and a digest of the dependencies. Neither reads `vitest.config.ts`.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens: none. `vitest.config.ts` (hook timeouts only), with the
  coordinator's go-ahead.

## Test plan

- unit (`test/architecture/harness-timeouts.test.ts`): every project that
  sets `testTimeout` sets `hookTimeout` to the same constant, and no project
  types a number. It fails on the config as it was.
- Not committed: the 12 s hook, run once each way.

## Issues

- Closes: #566 (items 1–3 are PR #578's).
- Opens: #579, a watch item for the stall that was not reproduced.

## Open questions

- None. The cause of the stall is open, and is #579's.
