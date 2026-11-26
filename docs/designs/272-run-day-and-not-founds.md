# Design: 272 `runDayOf` to `lib/dates`, the not-founds through `client.ts`

> Design 261 §B rows B10 and B13; design 258 proposals 10 and 11. Issue
> #1071. Behaviour-neutral.

## Problem

Two small leaks past a door. `entries/band-runs.ts` and
`following/profiles.ts` import `runDayOf` from `feed/public-web`, a
pure date function that has nothing to do with the open web. And
`src/named-not-found.tsx` imports `PIECE_NOT_FOUND` and `RUN_NOT_FOUND`
from inside `closet` and `runs`, which is why both modules hold a
past-the-door pin of 1 in `test/architecture/module-shape.json`.

## Approach

- **B10.** `runDayOf` moves to `src/lib/dates.ts`, beside `runZoneOf`,
  and takes the observed zone as a string rather than a `Conditions`,
  so `lib/dates` goes on importing nothing. Its three callers pass
  `conditions?.timeZone`. `feed/public-web`'s door drops the name (4 → 3),
  and `entries` and `following` stop importing that door. The other
  `runDayOf`, `feed/moderation/run-day.ts`, is a different function and
  stays.
- **B13.** `closet/client.ts` re-exports `PIECE_NOT_FOUND`, `runs/client.ts`
  re-exports `RUN_NOT_FOUND`, and `src/named-not-found.tsx` imports them
  from there. The two pins leave the pins file. The first step is
  `npm run build`, so `check:bundle` shows the bundle is unchanged:
  the two `client.ts` doors also re-export form code.
- No file moves, so `stryker.conf.json` is unchanged. `diagrams:generate`
  runs if the structure changes.

## Contract touches

- Schema changes: **none**. Bindings, queues, crons: **none**.
- Protected path: `test/architecture/module-shape.json` (the two pins).

## Test plan

- `test/lib/dates.test.ts` (worker): `runDayOf` reads the observed zone,
  else the runner's, else UTC, in the format it is given. It is pinned
  directly now that it lives in a file that is mutation tested on its own.
- Existing feed tests (public kit, profiles, band runs) prove the
  callers are unchanged. `test/architecture/module-shape.node.test.ts`
  proves the pins.

## Issues

- Closes: #1071
- Opens: none expected.

## Open questions

None.
