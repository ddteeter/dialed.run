# Design: 256 the outbox's fast path takes its own handler

## Problem

#886, after #796's moves. `settleOutbox` defaults its `handlers` to the
whole registry in `ops/outbox/outbox-handlers.ts`, which imports `email`,
`runs`, `safety` and `weather`. So a module that owes one debt and settles
it imports every handler, and `runs`, `safety` and `weather` cannot import
the outbox from service code. That is why `runs` takes an injected `owe`
and `safety`'s ban lift takes `Reopening` (docs/architecture.md). This
lane splits the outbox so that a caller settles with its own kind's
handler and `ops/outbox` imports only `ops/sentry`, `lib`, `db` and `env`.
Behaviour is unchanged.

## Approach

- **`ops/outbox/handler.ts`** (new): the handler types (`OutboxHandlers`,
  `OutboxHandler<K>`), `OWED_AGAIN`, `Refused` and `boundHandler`, moved out
  of `outbox-handlers.ts`. `outbox.ts` imports only this file and `sentry`.
- **`ops/outbox/storage-handlers.ts`** (renamed from `outbox-handlers.ts`):
  the R2-only handlers and their reconcilers, exported as
  `storageHandlers`, the four kinds that need nothing but `env`.
- **`ops/owed-email/`** (new sub-module): `emailHandler(deps)`,
  `owedEmailHandlers` (both email kinds, live) and `settleOwedEmail`, the
  fast path an `OwedMail` is handed. It imports `email`, `runs` and `safety`.
  **`ops`' barrel does not re-export it**, so `runs` and `safety` can import
  `ops` without a cycle. Its callers import the door itself.
- **`product_link`** moves to `closet/product-link.ts`, beside
  `linkTypedGarments`: `productLinkHandler(link)` and `ProductLinker`. Same
  behaviour: with no linker it throws, as the "no linker" firing test needs.
- **`manual_conditions_delete`** moves to `weather`: `manualConditionsHandler`,
  beside `forgetManualBand`. `weather` gains the import of `ops/outbox`.
- **`dispatch/outbox-handlers.ts`** (new) assembles the full registry,
  `outboxHandlers(link)`, typed `OutboxHandlers`, so the compiler still
  refuses a missing kind. `handlersFor` uses it.
- **`settleOutbox(db, debt, handlers, report?)`**: `handlers` is required,
  a map keyed by kind that must hold the debt's own kind
  (`Pick<OutboxHandlers, K>`), so a map without it does not compile. A bare
  handler could not promise that: handlers are compared by shape, and a
  photo's payload fits an entry's. `oweOutbox` keeps its message's type, and
  `OutboxDebtOf<K>` names one kind's debt. `emailDebt`, `banEmail` and
  `reopenEmailFor` return the `email` message type. `drainOutbox`'s
  `handlers` becomes required: nothing in `ops` can name the full registry.
- The callers pass their kinds: closet `photos.ts` ×2 and `service.ts`
  (`storageHandlers`), and account `verification`, `deletion`,
  `export-build` and `functions.ts`, `safety/functions.ts` ×2 and
  `ops/daily/digest-email.ts` (`settleOwedEmail`). `OwedMail["settle"]`
  keeps its shape, typed to an `email` debt. Feed's `retract.ts` `commit`
  settles five kinds for a run, an entry and a moderation decision, so it
  holds its own map of them (storage, email and the band).
- **Not in this PR:** removing the injected `owe` from `runs` (#923) and
  `Reopening` from `safety` (#924). This PR only makes both possible.
  docs/architecture.md's two passages that cite the cycle say so.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**
- Screens: none. Module shape: one new `ops` sub-module. `dispatch`'s
  fan-out stays 11 (it imports `closet` and `weather` already).

## Test plan

- Existing tests move with the code, with imports changed:
  `test/ops/outbox.test.ts`, the email tests and the drains in the safety,
  account, runs and closet tests pass a registry or the one handler.
  vitest, worker project.
- `test/dispatch/outbox-handlers.test.ts` (new, worker): the registry has
  every kind, binds each to its owner's handler and the product link to
  the linker passed in, and the band's Sentry context.
- dependency-cruiser and the module ratchet: `ops/outbox` reaches no
  feature module. `npm run diagrams:generate` redraws the structure.
- Stryker on every changed file.

## Issues

- Closes: #886
- Opens: none. Follow-ups #923 and #924 are already filed.

## Open questions

- Guess I'm proceeding on: the PR stacks on lane E's branch, because both
  edit `outbox-handlers.ts` and `dispatch/scheduled.ts`. It rebases onto
  main once lane E merges.
