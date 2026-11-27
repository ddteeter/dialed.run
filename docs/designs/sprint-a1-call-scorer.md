# Design: sprint-a1 the Call's scorer and shrinkage

> Sprint lane A1 of Epic 200. The coordinator gives this doc its number
> before any PR. Lanes A2 (evidence) and A3 (replay) build beside it against
> the same frozen contract, `src/modules/call/contract/`.

## Problem

The Call needs its pure core before any screen, table or cron exists: a
function that takes a runner's verdict history, the cohort's cells and an
hour's conditions and ranks the runner's own pieces, with the counted facts
behind each. Design 194 chose counting and shrinkage over a trained model,
and a pure function so the replay harness runs the code the Worker runs.

## Approach

A new sub-module, `src/modules/call/scorer/`, behind its own door (`score`,
`ENGINE_VERSION`, `COHORT_MIN_RUNNERS`, `workedRange`). No D1, env, fetch,
clock or randomness. One file per concern:

- `effort.ts`: the hour feels warmer by easy 0, steady 2, workout 5, race
  7 °C. The Call's band, and each past run's, is the band of its feel at
  its own effort.
- `personal.ts` counts the runner's runs in the Call's band and class,
  typed weather included: the band's verdicts, each piece's dialed-of-worn
  and flags, each group's runs with and without a piece. With no forecast
  it counts every band.
- `floor.ts` and `ladder.ts` pick the cohort cell for a group: the narrowest
  rung that counts runners like this one and has 5+ runners, in the band
  and among those who wore the group.
- `shrinkage.ts` is the blend. Each layer is pulled toward the one before
  it by `(successes + anchor × strength) / (trials + strength)`:
  1. prior: 0.7 when the estimate range holds the feel, less 0.05 per °C
     outside, floor 0.1; 0.5 with no estimate or no forecast. The feel is
     the hour at effort, less thermal level × 2.2 °C, plus the band's lean:
     (warm − cold) / (runs in band + 3) × 2.2 °C;
  2. cohort: the group's dialed share, weight `min(verdicts, 8)`, against
     the prior at strength 4;
  3. personal: the piece's dialed runs over its runs plus its flags (a flag
     is one more failed wear), against layer 2 at strength 3.
- `kit.ts`: tops, bottoms and shoes always; any other group only when the
  runner's runs settle it (wearing one was dialed more often than not
  wearing one) or, failing that, most of the cohort's runners wear one.
- `confidence.ts`, `facts.ts`, `score.ts`: the confidence ladder, each
  piece's evidence (only numbers the blend read), and the ranking, a total
  order: score descending, then `pieceId` ascending.
- `worked-range.ts`: #386's verdict-derived works-at range, as a pure
  function. Not wired into `closet`.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens implemented: **none**
- Shared with A2 and A3, byte for byte: `call/index.ts`, `call/contract/`,
  one `stryker.conf.json` entry (a protected path), `structure.generated.c4`.

## Test plan

All unit (vitest `worker`), under `test/call/scorer/`; no Playwright: there
is no screen and no server hop.

- `floor.test.ts`: the pin to `MIN_RUNNERS`; the floor at 4, 5 and 6
  runners, in the band and in the group.
- `personal.test.ts`, `ladder.test.ts`, `shrinkage.test.ts`,
  `confidence.test.ts`, `kit.test.ts`, `facts.test.ts`: every branch, each
  boundary exactly.
- `effort.test.ts`: the table, and no effort as easy.
- `score.test.ts`: each reading and each of the owner's answers as a named
  test; determinism (same request twice, shuffled history, closet and
  cohort); an ordering whose expected order is not id order; the
  tie-break; the no-forecast Call.

## Issues

- Closes: none. Opens: none (a cloud lane opens no issues). Informs #457,
  #386, #377, #400.

## Open questions

The owner answered Q1 to Q18 on 2026-11-26 (#1103); `QUESTIONS.md` has each
answer and what was built.

- Changed by the answers, and built: typed-weather runs count in the
  runner's own layer (Q3, and so Q11); the effort table (Q5); the band's
  lean (Q13); the floor on a cell's group runners (Q14).
- Stand as built, as `scorer-1`: the condition class (Q1), the 5 °C band
  (Q2), the thermal offset on estimate fit only (Q4), the cut at 6 runs in
  band (Q6), the kit's groups (Q7), the formula and constants (Q10), the
  no-forecast Call (Q12), what a flag counts for (Q15), ties (Q17).
- After the sprint: result-level evidence in the contract (Q16).
- Parked with the cohort cells table's design: cells per group or per
  garment type (Q8), how a climate zone is assigned (Q9).
- Settled: `"call"` in the table-owner map's `AREAS` (Q18).

Still open, raised by building the answers:

19. A fact's band, and the Call's, is the band of the feel at effort, and
    the cohort is looked up there: the rollup must count on the same
    footing, and the evidence lines must say which band they name.
20. `workedRange` counts typed-weather runs and does not shift for effort.

`best-guess` is no longer answered: the threshold and the evidence count
the same runs. `ENGINE_VERSION` stays `scorer-1`: no version has served a
Call yet.
