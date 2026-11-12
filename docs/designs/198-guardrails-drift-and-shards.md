# Design: 198 guardrails drift and mutation shards (#556, #581)

## Problem

`guardrails init --plan` reports three human-managed files as drifted on
every upgrade, and nobody had decided what to do about it (#556). The
guardrails-core pin is one release behind the fix for cold local gates.
Eight Mutation shards take over 90 minutes cold, and every PR that changes
those scopes waits on the longest, 158 minutes (#581).

## Approach

Two PRs, because the second runs its new shards cold and the first should
not wait on that.

What a mutate edit costs, corrected after PR 2's first run (2026-11-11):

- **In CI, only a new or renamed shard runs cold.** `mutation.yml` keys
  each shard's seed by shard name, so a shard that keeps its name restores
  main's seed. Nine of the 37 ran cold.
- **The local push-gate seed is discarded.** Its fingerprint pins the
  Stryker config, so any edit to `stryker.conf.json` invalidates it until
  main's next Mutation run uploads a new one.

**PR 1: the pin and the drift.**

- Pin guardrails-core 0.14.1 (`package.json`, lockfile). Its note wires
  nothing. The `*$handle*` negation from design 190 stays.
- The drift is declined (owner, 2026-11-11). Measured by applying `init` to
  a scratch copy on 0.14.0 and 0.14.1: the templates hold nothing the repo
  lacks, and `--force` would remove `sanctions-check` from
  `.githooks/pre-push` and the pinned SHAs, concurrency group, Chromium
  install and MediaPipe staging from `guardrails.yml`. The shared-file
  merges write nothing. Plain `--apply` writes one file, a reorder of
  `.codex/hooks.json`.
- `docs/guardrails/init-drift.md` records what is expected and how to
  re-check it at the next upgrade. A test pins the lines `--force` would
  remove, so the doc points at the test and does not carry a second list.

**PR 2: the split (#581).** One `stryker.conf.json` commit, 30 entries to 37. I checked the issue's proposal against main: every path exists, and the
groups are the ones its table names.

- The groups are the table in #581: `lib/photo-pipeline` into three;
  `lib/contracts/email`, `lib/contracts/products`, `modules/ops` and
  `modules/runs` into two each; in `modules/safety`, `classifier/**` leaves
  the blur entry, and the inputs entry keeps only `inputs.ts` and `index.ts`.
- Positive paths only. The existing `!functions.ts` negations stay, one
  per module. `mutation.yml` reads the array and does not change.
- **Target:** every cold shard at about 80 minutes or less, except
  `safety/inputs` (~123) and `lib/contracts/garments` (~97), which are one
  file each and belong to #570.

**PR 3: the 0.14.2 pin (#608).** Pin guardrails-core 0.14.2.

- `ship` now reads the workflow runs on the commit it pushed. A run that
  failed to start is `ci-red`, a required check that never reported is
  `ci-red`, and ship confirms the push reached origin. A lane no longer
  checks the run list by hand after a `green`.
- Its note wires nothing. Its one superseded phrase has no match in this
  repo's instructions, so no rule or skill changes.
- `init` shows what `docs/guardrails/init-drift.md` says to expect, and the
  templates still hold nothing the repo lacks.

## Contract touches

- Schema changes: **none**. Routes: **none**. Bindings/queues/crons: **none**.
- Screens: none.

## Test plan

- `test/architecture/init-drift.test.ts` (new, worker): `pre-push` runs
  `sanctions-check` after the gate; `guardrails.yml` pins every action to
  a SHA and keeps its concurrency group, Chromium install and MediaPipe
  staging.
- `mutation-config.test.ts` (existing): every `src/lib` and `src/modules`
  file is in exactly one entry and no entry names a dead path. Its comments
  stop counting entries.
- `server-functions-are-glue.test.ts` (existing): negations unchanged.
- No Playwright: nothing a user sees changes.

## Issues

- Closes: #556 (PR 1), #581 (PR 2), #608 (PR 3).
- Opens: #587. `modules/ops/outbox-handlers` took 106 minutes cold on
  PR 2's run, over the target; it is split again once main's next cold
  run gives per-file times.

## Open questions

- The plan will report the same three files as drifted at every upgrade.
  That is expected, and the doc says so.
