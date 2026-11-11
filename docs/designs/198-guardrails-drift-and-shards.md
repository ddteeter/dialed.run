# Design: 198 guardrails drift and mutation shards (#556, #581)

## Problem

`guardrails init --plan` reports three human-managed files as drifted on
every upgrade, and nobody had decided what to do about it (#556). The
guardrails-core pin is one release behind the fix for cold local gates.
Eight Mutation shards take over 90 minutes cold, and every PR that changes
those scopes waits on the longest, 158 minutes (#581).

## Approach

Two PRs, because the second discards every mutation seed and the first
should not wait on that.

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

- Closes: #556 (PR 1), #581 (PR 2).
- Opens: none planned.

## Open questions

- The plan will report the same three files as drifted at every upgrade.
  That is expected, and the doc says so.
