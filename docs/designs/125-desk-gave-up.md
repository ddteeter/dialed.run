# Design: 125 Desk · D-87's rail, Gave up on Today, the round 31 card

> Design-adoption PR B (ops/Desk lane). Owner-approved 2026-10-06, including
> the additive `add_gave_up` migration (R-119).

## Problem

The Desk's rail is round 27's (Gave up a destination, Access last), D0 now
draws D-87's, and Gave up has no rows to show: a job the system stops
retrying leaves only a status (`failed`, no reason, time or tries) and a
Sentry event, and a dead-lettered Strava reminder leaves nothing. The default
share card still says round 26's line.

## Approach

- **One table, `gave_up`** (`0049_add_gave_up`): `kind`, `subject_id`,
  `reason`, `raw_error`, `tries`, `first_failed_at`, `last_failed_at`;
  UNIQUE `(kind, subject_id)`, indexed on `last_failed_at`. Writers use
  `src/db/gave-up.ts` (upsert: tries add, first failure stays; clear),
  always inside the batch that marks their own status.
- **Writers.** `giveUpEach` wraps `deadLetterEach` (unchanged, so the export
  DLQ is untouched) and batches a job's writes with its row. Enrichment: DLQ
  and the terminal `PageFetchError` (status in words). Imports DLQ: imports
  and reminders (a reminder is keyed by its job, which Retry re-sends).
  Weather: the hourly cron's five-hour cap. Photo screening never gives up
  (its sweep retries `pending` forever) and writes nothing. A dead letter's
  tries are its queue's deliveries, `max_retries + 1`, from `queueRegistry`,
  pinned to `wrangler.jsonc` by `bindings-conformance`.
- **Clears.** Enrichment after a successful write-back; weather in
  `setStatus` whenever a run resolves; Retry and Drop delete the row.
- **Retry per kind, existing messages only (law 9).** Enrichment: Re-fetch
  is `requestEnrichment` (claims `failed`, sends `enrich`); Re-run extraction
  is `reextract` over the stored page, disabled when there is none
  (`0050_add_product_snapshots_product_index` makes that read indexed).
  Weather: back to `pending`, which the hourly cron re-drives. Import: back
  to `pending` with its owed file expiry cancelled, then `import` is sent
  (the stalled-import sweep covers a lost send). Reminder: the stored job is
  sent again, then the row goes.
- **Read.** `ops/gave-up.ts`: the count and oldest for the rail, Today and
  the digest; the rows, newest first, each with what it was doing from a
  keyed lookup of its subject. All Desk functions are `requireAdmin(await
verifiedUserId())`.
- **UI.** `DeskShell`: Today, Review, Access, Duplicates, Runners; Today's
  count is Gave up's. `Today`: a Gave up section under the three numbers,
  two newest then "+ N MORE · SHOW ALL", "Nothing gave up." at zero.
- **Digest.** One optional `gaveUp` field on the digest template (law 9),
  one line in the body when above zero, and the zero subject only when it is
  zero too.
- **OG.** `DefaultCard` is round 31's: wordmark TYPE.title, "Wear what
  worked." TYPE.display, `DIALED.RUN` MONO.sm muted, SPACE[8], at 2×.

## Contract touches

- Schema: `0049_add_gave_up`, `0050_add_product_snapshots_product_index`,
  both additive. PR E (account/auth) also adds a migration; whichever merges
  second renumbers (law 11).
- Routes: `routes/desk/index.tsx` gains a loader (glue).
- Bindings/queues/crons: none.
- Screens: Operator Screens D0, D6; Round 29 B·2; Round 31 #6.

## Test plan

Worker: `test/lib/gave-up.test.ts`, the writers in each consumer's test,
`test/ops/gave-up.test.ts` (list, count, Retry per kind, Drop, idempotency),
digest. UI: `test/ops/desk-shell.dom.test.tsx`, `test/ops/today.dom.test.tsx`.
e2e: D0 conformance flipped to the board; the Desk demo extended.

## Open questions

- A dead letter's reason is generic: the DLQ is handed the job, not the
  error (each try's error is in Sentry). Recorded as a design delta.
