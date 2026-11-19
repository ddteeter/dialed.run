# Design: 242 import-consumer

## Problem

Three faults in the import consumer can each leave a runner with a wrong
log: a second copy of a job can parse a file another copy is working
(#841), an import can end a duplicate of its own run (#842), and the kit
reminder can be lost for good (#843). The import stories also differ from
the code in 19 places (#844, #845), and Review's Keep e2e failed once in CI
(#859).

## Approach

All in `src/modules/runs/consumer.ts` unless named.

- **#842, #843: one concluding batch.** The `runs` insert goes first, then
  `done`, the Strava pairing, the file's deletion, and the kit reminder as
  `notificationInsert`. The separate insert and `createNotification` go.
- **#841: a claim token** (owner, 2026-11-18). An `import` message carries
  an optional `claimId` its sender mints, through one constructor in
  `queue-messages.ts` that the three senders call: the upload
  (`runs/imports.ts`), the daily sweep (`ops/scheduled.ts`) and the Desk's
  Retry (`ops/gave-up.ts`). The claim writes it to a new
  `imports.claimed_by`. A redelivery takes back a `processing` row only
  where `claimed_by` is its own `claimId`; the parse-limit check fails a
  row only on the same condition. A message with no `claimId` claims a
  `pending` row and nothing else. `didClaim` (`lib/sql/claim.ts`) already
  takes the extra condition, so it does not change.
- **Not chosen:** the queue's own message id as the token (Cloudflare's
  docs do not say it is the same on a redelivery), and a claimed-at with a
  time limit (a redelivery arrives in seconds, so it needs delayed retries
  or a sweep of `processing` rows).
- **#844, #845:** each listed difference fixed in `flows/import.c4`,
  preferring notes; the upload's guards and the file's deletion move to a
  sub-story so `importStory` stays in its step budget. Steps 7 and 9 say
  what the fixes above make true.
- **#859, its own PR** (`test/w15-keep-e2e`). The failed run's query tally
  shows Keep's batch ran, a rejected Keep shows the Desk's failure band,
  and the logged `SQLITE_BUSY` came from the spec's side almost five
  minutes earlier. The row leaves on the response, so the spec waits for
  Keep's server-function response and asserts it is ok before it asserts
  the row is gone. No change in `src/modules/safety/`, and no retry.

## Contract touches

- Schema: **one additive column**, `imports.claimed_by` (nullable text),
  core migration `0008_add_import_claimed_by`. Approved by the owner,
  2026-11-18. `docs/contracts.md`'s `imports` line gains it.
- Queue message: `import` gains optional `claimId` (law 9). No new variant.
- Routes, bindings, queues, crons, screens: **none**.

## Test plan

All vitest, `worker` project, in `test/runs/consumer.test.ts`; each fails
on today's code first.

- #841: a redelivery leaves a `processing` row another message claimed,
  and does not fail it past the parse limit; the interleaving (first
  delivery throws, a second message claims, the first's retry arrives
  mid-parse) ends with one run and `done`; a redelivery still takes back
  its own row; a message with no `claimId` claims only `pending`.
- #842: the concluding batch fails once; the redelivery ends `done` with
  one run, the reminder paired and the file's deletion owed once.
- #843: the kit reminder's insert fails once; the redelivery writes it.
- `queue-messages`: the constructor mints a different `claimId` per
  message, and the old shape still parses. The senders' tests pin that
  each send carries one.
- #859: the spec itself (e2e, because the fault is the spec's timing).

## Issues

- Closes: #841, #842, #843, #844, #845; #859 in its own PR.
- Opens: the dead-letter handler fails an import another message is
  working (the same crossing as #841, reached only after four throws).

## Open questions

- Guess: `claimed_by` is left set when an import concludes. Nothing reads
  it then, and clearing it adds a write to four batches.
