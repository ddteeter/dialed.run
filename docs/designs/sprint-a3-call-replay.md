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
  judged feel and precipitation class as the forecast. Manual-weather runs are
  dropped by one named filter, `isReplayable`, from both the cases and the
  history.
- `run.ts`: `replay(scorer, cases)` → one outcome per case.
- `metrics.ts`: dialed agreement, direction on misses (with "no call" kept
  apart from misses), coverage, and each of the first two split by
  `Confidence`.
- `compare.ts`: `noWorse(baseline, candidate, tolerance)` → a verdict per
  release metric and an overall pass.
- `synthetic.ts`: a seeded PRNG (mulberry32) and six personas whose truth is
  stated: runs cold, runs warm, sparse, one band, a trip, a flagged piece.
  Pieces take their group from `uiGroupFor` and their range from
  `estimateTempRange`; cohort cells are generated at 5+ runners.
- `report.ts`: two versions' metrics as a plain-text table for a PR body.
- `eval/call/run.ts` (optional): `npx tsx eval/call/run.ts <baseline> <candidate>`,
  each a module path whose default export is a `Scorer`, replays both over
  the personas and prints the report. No npm script.

**What the synthetic cases are.** They are v1-shaped histories: runs with a
verdict and what was worn, before any Call was served. Replaying them asks
"would the scorer have picked what a dialed runner wore", not "did the served
Call do better than the last one". Logged Calls add the served kit and its
ranking; when the export exists its rows map onto `ReplayCase` (see Q2).

**Measures, as built** (each a guess, Q1):

- _Dialed agreement_: on verdict-0 cases, of the distinct groups worn, the
  share where the kit's piece in that group is one of the pieces worn.
- _Direction on misses_: on cold verdicts the kit should be warmer than what
  was worn, on warm verdicts cooler. Per group: the same piece is "same"; two
  pieces with comparable ranges compare by `lowC`, else `highC` (lower is
  warmer); a group the kit adds is warmer, one it drops is cooler, but only for
  a piece with an estimate. A case is a hit only when every comparable group
  moves the right way or stays; "mixed" and "same" are misses; a case with no
  comparable group is "no call".
- A `below-threshold` result is "no call" in both, since it offers no kit.
- _Coverage_: cases whose confidence is not `below-threshold`.

## Contract touches

- Schema changes needed: **none**. The call log and export are hard stops (Q2).
- New route files: none. New bindings/queues/crons: **none**.
- Screens: none. Shared skeleton added byte for byte; one `stryker.conf.json`
  `mutate` entry; regenerated `structure.generated.c4`.

## Test plan

All vitest `worker`, `test/call/replay/*.test.ts`; no Playwright (no screen).

- `case.test.ts`: no leakage with runs given out of order, ties excluded, the
  forecast's precip maps back to its class, the manual filter.
- `metrics.test.ts`: each measure on hand-built outcomes at each boundary,
  no-call apart from misses, calibration split.
- `compare.test.ts`: equal, better, worse, worse within tolerance (at exactly
  the tolerance and past it), unmeasured, an empty case list, mismatched sets.
- `synthetic.test.ts`: same seed deep-equal, two seeds differ, each persona's
  truth visible (a knowing fake scorer beats an ignorant one), cells at 5+.
- `run.test.ts`: a fixed-kit fake scorer shows the harness measures the kit,
  not the ranking order. `report.test.ts`: the table.

## Issues

- Closes: none (the sprint's issues are the coordinator's).
- Opens: none from a cloud lane; questions are in `QUESTIONS.md`.

## Open questions

1. Which metrics are the release bar, and the tolerance. Built: dialed
   agreement and direction together, tolerance 0, unmeasured on either side
   fails, coverage reported but not gated.
2. The export's shape. `ReplayCase` is request + worn + verdict; the log must
   keep the full request (conditions, history ids, closet with estimates,
   cohort cells read), engine version, ranking, kit and the linked verdict.
3. The forecast built for a historic run: `tempC` is the judged feel, wind 0,
   `precipMm` a representative of the stored class (0, 1, 5).
4. Manual-weather runs are left out of replay entirely (`isReplayable`).
5. Climate zone strings are a guess (`Cfb`, `BWh`); no vocabulary exists yet.
