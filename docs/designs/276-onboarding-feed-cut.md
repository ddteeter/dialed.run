# Design: 276 the onboarding/feed pair is cut

> Design 261 §B row B2: design 258 proposal 2, and the backlog types to
> `src/lib/contracts`. Issue #1075. Behaviour-neutral: every server
> function keeps its method, validator and auth gate.

## Problem

`feed` and `onboarding` import each other. `feed/functions.ts` saves a
place through onboarding's writer, and `onboarding` reads feed's coverage
for the Call ladder. Separately, `runs`' backlog table imports its row
types from `feed`. Each edge counts against a fan-out pin and the
direction number (design 261 ruling 4). This lane cuts all three edges.
None of them is a dependency the code needs.

## Approach

**(a) Use this, on Your conditions.** `saveConditionsCityAction` moves
from `feed/functions.ts` to `onboarding/functions.ts`, and uses that file's
`zonesFor`. `src/routes/feed/index.tsx` imports it from there and still
hands it to feed's tab as a prop. `placeInput` and `Place`, with the three
schema parts they share with `calibrationInput` (`profileLatitude`,
`profileLongitude`, `placeStampSchema`), move to
`src/lib/contracts/city-lookup.ts`, beside `FoundPlace`. `onboarding/inputs.ts`
imports the three from there. The onboarding door drops `placeInput`,
`Place`, `saveFoundPlace` and `placeStampsFromEnv`. `savePlace` stays,
since two tests import it there. Fixing those tests is C2's job.

**(b) The Call ladder.** `onboarding/ladder.ts` becomes
`feed/consensus/ladder.ts`, and `onboarding/components/CallLadder.tsx`
becomes `feed/consensus/components/CallLadder.tsx`. `callLadderQuery`
moves to `feed/functions.ts`, which imports `ladderFrom` and
`coverageLadder` from `./consensus`. `src/routes/call/index.tsx` follows.
The feed door drops `coverageLadder` and `CoverageBand`, whose only
importer outside feed was onboarding. Their tests move to `test/feed/`.

**(c)** `settingsSubPageData` takes `Promise<B>` and returns `B`, and stops
naming `BellState`. The route's call is unchanged.

**(d) The backlog types.** `BacklogKit`, `BacklogSuggestion`, `BacklogRow`
and `Backlog` (`feed/attach/backlog.ts:55-93`) move to
`src/lib/contracts/backlog.ts`, in the barrel. `backlog.ts` and
`runs/components/VerdictBacklog.tsx` import them from there, and the feed
and `feed/attach` doors drop them.

**Files keyed by a server function's home** follow the moves:
`test/architecture/verification-class.test.ts` keeps both classes
(`unconfirmed`), and `e2e/query-baseline.json` renames two keys.
`stryker.conf.json` needs no edit, because the moved files stay inside
their entries' module globs and `src/lib`. Pins are lowered on A1's
`module-shape.json` after the rebase.

## Contract touches

- Schema: **none**. Routes: two import lines (`call/index.tsx`,
  `feed/index.tsx`). Bindings/queues/crons: **none**. Screens: none change.

## Test plan

- The existing suites move with their files and are not rewritten:
  `ladder.test.ts` and `call-ladder.dom.test.tsx` go to `test/feed/`, and
  the `placeInput` cases in `test/onboarding/profile.test.ts` import from
  `lib/contracts`.
- The module ratchet and `verification-class.test.ts` hold the moves.
  `diagrams:stale` lists the stories to re-read.

## Issues

- Closes #1075.

## Open questions

None.
