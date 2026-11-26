# Design: 273 the purge forgets the enrichment count through the counters

> Wave 19, lane B1 (#1072). Design 261 §B row B1, design 258 proposal 1.

## Problem

The purge forgets each runner-keyed counter with `email`'s
`forgetRateLimit`, but forgets enrichment's count through its own
`forgetRunnerEnrichmentLimit`, a one-line wrapper. That one import is
`account`'s only reason to reach `enrichment`, so it costs a fan-out edge.

## Approach

- `src/modules/account/purge/purge.ts`: the wrapper's call becomes
  `forgetRateLimit(db, "enrich-runner", userId)`, in the form of the ten
  lines above it, and the `enrichment` import goes. The batch holds the same
  statement, so the change is behaviour-neutral.
- `src/modules/enrichment/spend-limit.ts` and `enrichment/index.ts`:
  `forgetRunnerEnrichmentLimit` and its export go. Its test block in
  `test/enrichment/spend-limit.test.ts` goes too. The purge test already
  checks the `enrich-runner` count is forgotten (`runnersCount`).
- `test/architecture/module-shape.json`: `account`'s fan-out 9 → 8,
  `enrichment`'s door 20 → 19, and the knip-doors pin once A4 has landed.
  Each is measured on the rebased branch, not taken from this doc.
- **One behaviour change (owner, 2026-11-26, #1076).** The purge also
  forgets `handle-runner`, the one count whose subject is the runner's id
  that it missed. The runner-keyed kinds become one list, `RUNNER_COUNTS`,
  mapped onto `forgetRateLimit`, where a new kind is added.
- `eslint/table-owners.ts` (A2): no line changes. The purge's
  `rate_limits` delete was already made inside `email`'s helper, which owns
  the table. The rebase onto A2 confirms that the lint stays clean.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**
- Screens: none

## Test plan

- `test/account/purge.test.ts` (worker) already covers the `enrich-runner`
  count's deletion. New: the seed writes a `handle-runner` count, the
  footprint reads it, and "forgets the runner's handle-claim count" checks
  it is there before the purge, gone after, and another runner's stays.
- The module ratchet's pins are lowered to the measured numbers.

## Issues

- Closes #1072.
- Closes #1076: the owner ruled yes, and the change is in this PR.

## Open questions

None.
