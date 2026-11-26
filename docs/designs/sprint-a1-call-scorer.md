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
`ENGINE_VERSION`, `COHORT_MIN_RUNNERS`). No D1, env, fetch, clock or
randomness. One file per concern:

- `personal.ts` counts the runner's runs in the Call's band and class: the
  band's verdicts, each piece's dialed-of-worn and flags, each group's runs
  with and without a piece. With no forecast it counts every band.
- `floor.ts` and `ladder.ts` pick the cohort cell for a group: the narrowest
  rung that counts runners like this one and has 5+ runners.
- `shrinkage.ts` is the blend. Each layer is pulled toward the one before
  it by `(successes + anchor × strength) / (trials + strength)`:
  1. prior: 0.7 when the estimate range holds the feel (feel shifted by
     thermal level × 2.2 °C), less 0.05 per °C outside, floor 0.1; 0.5 with
     no estimate or no forecast;
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

- `floor.test.ts`: the pin to `MIN_RUNNERS`; the floor at 4, 5 and 6.
- `personal.test.ts`, `ladder.test.ts`, `shrinkage.test.ts`,
  `confidence.test.ts`, `kit.test.ts`, `facts.test.ts`: every branch, each
  boundary exactly.
- `score.test.ts`: each reading below as a named test; determinism (same
  request twice, shuffled history, closet and cohort); an ordering whose
  expected order is not id order; the tie-break; the no-forecast Call.

## Issues

- Closes: none. Opens: none (a cloud lane opens no issues). Informs #457,
  #386, #377, #400.

## Open questions

Each is built as one named constant or function, tested by name, and
written out in `QUESTIONS.md` (Q1 to Q17) with a recommendation; Q18 there
is about the shared skeleton, not the scorer:

1. Condition class is `PrecipClass`.
2. The band is the 5 °C `bandFloorC` band.
3. Manual-weather runs are left out of personal counts.
4. The thermal offset shifts the feel against estimates only.
5. Effort is accepted and unread.
6. The confidence ladder, and its cut at 6 runs in band.
7. Which groups a kit fills.
8. Cohort cells are per group, not per garment type.
9. A climate zone is an opaque string.
10. The formula and its constants.
11. The threshold counts every verdict, typed weather included, so it
    agrees with the teaser.
12. A Call with no forecast: every counted run, `probable` at best, zero
    runs in band.
13. Verdict direction is unread: cold and warm both count as "not dialed".
14. The floor is on a cell's band runners, not its group runners.
15. What a flag counts for.
16. The band's fact rides on every piece: the contract has no result-level
    evidence.
17. Ties are broken in English collation.
