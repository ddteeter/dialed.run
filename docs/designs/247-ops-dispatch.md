# Design: 247 ops into sub-modules, and `dispatch`

## Problem

Wave 16's lane A (#796 step 5, first move). `ops` is a floor seven
modules import and a roof that imports eight, so it sits in the module
cycle. This lane moves `ops` into the sub-modules design 240 names and
lifts the roof out into the new top-level module `dispatch`. A move: paths
and imports change, behaviour does not.

## Approach

The tree is design 240 §"The tree" › `ops`, unchanged:

- `dispatch/`: `scheduled.ts`, and `queues.ts` holding `handleQueueBatch`.
  Only `src/server.ts` imports it.
- `ops/sentry`, `ops/outbox`, `ops/edge`, `ops/public-web` (with `og/`),
  `ops/speed`, `ops/desk` (with the five Desk components in
  `ops/desk/components/`), `ops/daily`. Each gets an `index.ts` door;
  files in one sub-module reach another only through its door.
- `ops/` keeps `index.ts`, `functions.ts`, `inputs.ts`.

Knots 1–3 from design 240, each behaviour-preserving:

1. `ops/queues.ts` splits: `handleQueueBatch` (and its private helpers) to
   `dispatch/queues.ts`; `oweInCore` into `ops/outbox/outbox.ts`; the queue
   registry, `consumedQueueNames`, `deliveries`, `enrichmentDeps` and the
   `ExportConsumers` type to `ops/desk/queues.ts`.
2. `PUBLIC_ORIGIN` moves to `src/lib/public-origin.ts`; `site-head.ts`,
   `sentry.ts`, the two public routes and the tests import it there.
3. `ops/index.ts` drops `handleScheduled`, `handleQueueBatch` and the 18
   names only the Worker entry and routes use, keeping the 21 other
   modules import. `server.ts` and the API routes import the doors.

The seven `DailyUpkeep` hand-ins stay until lane E (design 253).

Shared files: `src/server.ts`' ops imports, `stryker.conf.json`' two ops
entries (one glob per sub-module, plus `dispatch`), the architecture tests
that name ops component paths, `test/architecture/module-shape.json`
(`ops` lowered by `npm run modules:pin`; `dispatch`'s fan-out pin added
by hand, owner's answer 2 on #796), and `docs/contracts.md` §Component
convention, rewritten for sub-module `components/` folders.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Forbidden zone: `.dependency-cruiser.cjs` `lib-browser-is-client-only`
  names `^src/modules/dispatch/` in place of `ops/(queues|scheduled).ts`
  (owner grant, 2026-11-19, in lane 16a's session).
- Forbidden zone, path-only re-keys for the files that move (owner grant,
  2026-11-19): four grant keys in `guardrails.config.json` (`health.ts`,
  `scheduled.ts` twice, `gave-up.ts`) and `eslint.config.js`'
  `primitiveExemptions` entry for `og/cards.tsx`.
- Screens: none change.

## Test plan

- No new behaviour, so no new tests: every existing test follows its file
  to the new path (`test/ops/` keeps its folder; `scheduled.test.ts`
  moves to `test/dispatch/`).
- `test/architecture/module-shape.node.test.ts` pins the new shape.
- Mutation: renamed files are not mutated at push; CI's ops shards run
  cold once (two to three hours).

## Issues

- Refs #796 (stays open for lane E).

## Open questions

None.
