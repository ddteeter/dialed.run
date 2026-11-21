# Design: 253 the dispatch imports the doors

## Problem

Lane E of #796 (design 240 §"Order of the moves", step 3). Lanes A to D
moved `ops`, `account`, `safety` and `feed` behind doors, so the work the
daily and hourly firings run no longer has to be handed in through
`src/server.ts`. Today the Worker entry imports seven files past a
module's door, and `handleScheduled` and `handleQueueBatch` take eight
jobs from it. This lane has `dispatch` import them itself. Behaviour is
unchanged: the same jobs run on the same firings.

## Approach

- **`auth/expired-rows/`** becomes a sub-module: `expired-rows.ts` moves
  in, behind its own `index.ts`. `auth/index.ts` pulls the framework, and
  no test can import it, so the dispatch imports this door, not the module.
- **`dispatch/scheduled.ts`** imports the seven jobs itself:
  `purgeDueAccounts` (`account/purge`), `sweepExports` (`account/export-build`),
  `rescreenHandlesFromEnv` (`account/handles`), `forgetAnsweredRequests`
  (`account/access`), `linkTypedGarments` (`closet`), `sweepExpiredAuthRows`
  (`auth/expired-rows`) and `sweepCopyrightHolds` (`feed/moderation`).
- **`DailyUpkeep` stays as the test seam,** the way `reporter` defaults to
  Sentry. `handleScheduled` spreads what it is handed over `liveUpkeep`, the
  seven real jobs, so production passes only the two speed fields. Those two
  stay handed in because they read the route tree, which only the Worker
  entry builds. A test that wants a firing with no purge passes the field
  as `undefined` explicitly.
- **`dispatch/queues.ts`**: `handleQueueBatch`'s `exports` defaults to
  `exportConsumersFromEnv()`, so `server.ts` stops handing the export
  consumers in. The `ExportConsumers` type stays in `ops/desk` (account
  implements it), and `ops/index.ts` stops re-exporting it.
- **`src/server.ts`** imports `dispatch`, `ops`' doors and `auth`, and
  nothing past a door.
- Comments that say "handed in because `ops` cannot import X" are
  rewritten where the reason no longer holds (the dispatch is not `ops`).

`dispatch`'s fan-out goes from 7 to 11 (adds `account`, `auth`, `closet`,
`feed`), over the budget of 7 by design: its pin is added to
`test/architecture/module-shape.json` by hand (owner's answer 2 on #796,
"pinned at what it imports"). `npm run modules:pin` lowers `auth`'s
past-the-door pin, if the move takes it to zero.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Forbidden zones: none. `lib-browser-is-client-only` already names all of
  `dispatch/`; the purge, export sweep and export consumers it still
  names under `account/` are 16b's entries, and unchanged.

## Test plan

- `test/architecture/daily-upkeep.test.ts` (worker, reads source): rewritten
  to read `dispatch/scheduled.ts` and `dispatch/queues.ts` for the seven
  imports and the defaults, and `server.ts` for the two speed fields and
  for no import past a door.
- `test/dispatch/scheduled.test.ts`: one test that a firing handed no
  upkeep runs the live jobs (the default's own observation), plus the
  existing tests passing explicit fields.
- `test/dispatch/queues.test.ts`: the `dialed-exports` default.
- The module-shape ratchet: `dispatch` pinned at 11; `auth`'s
  past-the-door count falls.

## Issues

- Refs #796. Closes it if nothing is left: steps 1–5 done.
- #886 (the outbox's fast path takes its own handler) is a separate PR on
  its own branch, after this one.

## Open questions

None.
