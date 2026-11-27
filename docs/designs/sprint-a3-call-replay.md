# Design: sprint-a3 the Call's replay harness

> Sprint lane A3 (Epic 200, design 194). The coordinator numbers this doc
> before any PR. Siblings: A1 the scorer, A2 the evidence lines.

## Problem

Design 194 makes replay the release check for every scorer version: "replayed
over logged Calls that have verdicts, must not do worse, then ships". This lane
builds that check, generic over the shared `Scorer` contract, and seeded
synthetic runner histories to replay over until the call log and its
pseudonymised export exist (both hard stops).

## Approach

`src/modules/call/replay/`, behind its own door; pure, no clock, no I/O.

- `case.ts`: a `ReplayCase` is a `CallRequest` plus what followed it (the
  pieces worn, the verdict). `casesFrom(history, cohort)` turns one runner's
  runs into cases with no leakage: run _n_'s request carries only runs that
  started strictly before it, whatever order they were given in, and run _n_'s
  judged feel and precipitation class as the forecast, and is marked
  `origin: "rebuilt"`. Manual-weather runs stay in every history, as the
  scorer's personal layer counts them, but `isCaseRun` never makes one a case
  (owner, 2026-11-26).
- `run.ts`: `replay(scorer, cases)` → one outcome per case.
- `metrics.ts`: dialed agreement, direction on misses (with "no call" kept
  apart from misses), coverage, and each of the first two split by
  `Confidence`.
- `compare.ts`: `noWorse(baseline, candidate, { tolerance, reads })` → a
  verdict per release measure, the source, a stated reason if blocked, and an
  overall pass. All three measures gate, each on its own, at tolerance 0;
  better on one and worse on another fails; unmeasured fails (owner,
  2026-11-26). `reads` is the candidate's declared forecast reads: a scorer
  that names `tempC` or `windKph` is blocked when every case was rebuilt,
  since a rebuilt case carries neither. **The wiring PR supplies the
  scorer's declaration**: this lane cannot read A1's scorer.
- `probe.ts`: `observedReads(scorer, cases)` checks the declaration by
  asking: each forecast case is replayed once more per field, with that field
  moved far out of range (constants, not arithmetic), and a field whose move
  changes any result is read. `noWorse` takes the observed list and blocks a
  candidate that reads a field it did not declare, before the rebuilt guard
  (owner, 2026-11-27). The eval wires both.
- `synthetic.ts`: a seeded PRNG (mulberry32) and six personas whose truth is
  stated: runs cold, runs warm, sparse, one band, a trip, a flagged piece.
  Pieces take their group from `uiGroupFor` and their range from
  `estimateTempRange`; cohort cells are generated at 5+ runners.
- `report.ts`: two versions' metrics as a plain-text table for a PR body,
  with its `source` as a field and a first line: v1 history (rebuilt),
  logged Calls, or mixed.
- `eval/call/run.ts`: `npx tsx eval/call/run.ts <baseline> <candidate> [seed] [tolerance] [reads]`,
  each a module path whose default export is a `Scorer`, `reads` a comma list
  such as `feelsLikeC,precipMm`; replays both over the personas, prints the
  report and exits 1 when the check fails.
  No npm script.

**What the synthetic cases are.** They are v1-shaped histories: runs with a
verdict and what was worn, before any Call was served. Replaying them asks
"would the scorer have picked what a dialed runner wore", not "did the served
Call do better than the last one". v1-history replay is the release check
until the call log has verdicts on served Calls; then the gate moves to
logged Calls, with v1 history as a second report (owner, 2026-11-26).

**Measures:**

- _Dialed agreement_: on verdict-0 cases, of the distinct groups worn, the
  share where the kit's piece in that group is one of the pieces worn.
- _Direction on misses_: on cold verdicts the kit should be warmer than what
  was worn, on warm verdicts cooler. Per group: the same piece is "same"; two
  pieces with comparable ranges compare by `lowC`, else `highC` (lower is
  warmer); a group the kit adds is warmer, one it drops is cooler, but only for
  a piece with an estimate. A case is a hit only when some group moves the
  right way and none the wrong way; anything else is a miss; a case with no
  comparable group is "no call".
- A `below-threshold` result is "no call" in both, since it offers no kit.
- _Coverage_: cases whose confidence is not `below-threshold`.

## Contract touches

- Schema changes needed: **none**. The call log and export are hard stops.
- New route files: none. New bindings/queues/crons: **none**.
- Screens: none. Shared skeleton added byte for byte; one `stryker.conf.json`
  `mutate` entry; regenerated `structure.generated.c4`.

## Test plan

All vitest `worker`, `test/call/replay/*.test.ts`; no Playwright (no screen).

- `case.test.ts`: no leakage with runs given out of order, ties excluded, the
  forecast's precip maps back to its class, manual runs in history and never
  cases.
- `metrics.test.ts`: each measure on hand-built outcomes at each boundary,
  no-call apart from misses, calibration split.
- `probe.test.ts`: each field found alone and together, in order; a read on
  one case of many; no probe without a forecast; a case already at the probe
  value; cases left unchanged.
- `compare.test.ts`: equal, better, worse on each measure, worse within
  tolerance (at exactly the tolerance and past it), unmeasured, an empty case
  list, mismatched sets, the rebuilt-forecast guard, undeclared reads, the
  source.
- `synthetic.test.ts`: same seed deep-equal, two seeds differ, each persona's
  truth visible (a knowing fake scorer beats an ignorant one), cells at 5+.
- `run.test.ts`: a fixed-kit fake scorer shows the harness measures the kit,
  not the ranking order. `report.test.ts`: the table.

## Issues

- Closes: none (the sprint's issues are the coordinator's).
- Opens: none from a cloud lane; questions are in `QUESTIONS.md`.

## Requirements on the call-log and rollup designs (owner, 2026-11-26)

No code here; these bind the designs that build the export.

- **Inputs by reference, stamped.** A served Call logs its inputs by
  reference, with a version stamp for each row read (each run's and
  garment's version or `updated_at` at serve time), so an export row maps
  onto `ReplayCase` field for field: the request as served, the engine
  version, the ranking, the kit and the linked verdict with the pieces worn
  and their flags.
- **Edited and deleted cases.** At export, a case whose rows were edited
  since serving is left out of the release gate and reported apart; a case
  whose rows were deleted drops. Deletes always win (design 271).
- **Cohort generations.** The rollup keeps each cohort generation and the
  log records which one a Call read, so replay reads the cohort as it was.
  Until then one snapshot serves every case; the synthetic cells are random,
  not rolled up from the runs, so they leak nothing.

## Open questions

All eight were answered (owner, 2026-11-26, issue #1105); `QUESTIONS.md`
keeps the record. Still open here:

- `CONFIDENCES` lands in `call/contract` in the scorer's PR (#1103); replay
  keeps its compiler-checked rank record until it switches at rebase.
- Climate zone names are parked with the cohort cells table; `Cfb` is
  synthetic only.

The flagged persona flags the long sleeve above 10°: in the seeded closet
the shell, not the jacket, is what the persona wears above 3°.
