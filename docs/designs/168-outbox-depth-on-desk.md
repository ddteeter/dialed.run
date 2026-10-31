# Design: 168 Outbox depth on the Desk and in the digest

## Problem

Design 162 made the daily digest report outbox rows still due after its
drain, but only to Sentry. R-169 puts that backlog where the operator
already looks: the Desk's Today and the morning email (owner, 2026-10-31,
"Desk and email now", rather than waiting for a production baseline).

## Approach

**What the number is.** Most kinds drain only in the 12:00 UTC digest;
`email` and `product_link` also drain hourly. So a live "due now" count
read at 15:00 would show three hours of ordinary, not-yet-drained rows as
backlog. The number is instead **rows due at the last digest's start that
are still due**: `stillDueOf(db, digestRanAt)`, where `digestRanAt` is the
`daily-digest` heartbeat, written before the firing does anything. After
the drain, a row it claimed has moved to its backoff (later than
`digestRanAt`), so what is left is what the cap never reached, minus any
that hourly drains or fast paths have since paid. No heartbeat yet (a
fresh deploy) means zero. No schema change: the read is the existing
range on `outbox_kind_due`.

**One read for both surfaces** (as D5 wants for the three numbers).
`todayCounts` in `src/modules/ops/desk.ts` gains `outboxBehind` (rows) and
`oldestBehindAt` (the earliest `next_attempt_at`), summed across kinds.
The digest email is owed after the drain in the same firing, so the email
and the Desk read the same rows.

**Desk.** Not a fourth `Stat`: D5 draws three numbers and D6 kept them
three by giving Gave up its own section. It is one line under the three
numbers, beside the skipped-digest line (round 38 #62b), shown only
above zero. It uses that line's shape: MONO.xs hi-viz kicker, then body.

> RUNNING BEHIND
> 12 queued jobs were still due after this morning's run. The oldest has
> waited 38h.

The age is in whole hours, as "Oldest · 19h" and the Sentry line count
it. (`spanOf` would turn 38h into "1d".) There is no per-kind breakdown,
because Sentry has one line per kind.

**Email.** One sentence after the Gave up line, only above zero (D6's
rule): "12 queued jobs were still due after this morning's run. They're
on the Desk's Today." The subject is unchanged: a backlog is not a
failure.

**Wire format (law 9).** The `digest` template (`lib/contracts/email-kinds.ts`)
gains `outboxBehind: z.int().min(0).optional()`. A digest owed by the
previous deploy has no such field, and that reads as none.

**Docs.** Add an open-queue item to `docs/design-deltas.md` for the
undrawn line, mark R-169 Done in `docs/deferred.md`, and reword design
162's open question to point here.

## Contract touches

- Schema changes needed: **none**
- New route files: none (`/desk`'s loader already passes `deskToday`)
- New bindings/queues/crons: **none**
- Screens: D0 Today and D5 digest, with one undrawn line on each
  (design delta)

## Test plan

- `test/ops/desk.test.ts` (worker): with a heartbeat at T, rows due at
  T−1h and still due are counted along with the oldest of them. A row due
  after T is not counted, nor is one in backoff. With no heartbeat the
  count is 0. Add a plan test that the read uses `outbox_kind_due`.
- `test/ops/digest-email.test.ts` (worker): `digestTemplate` carries
  `outboxBehind`.
- `test/email/render.test.ts`: the line appears above zero and not at
  zero or when the field is absent (an old row). The subject is unchanged.
- `test/ops/today-gave-up.dom.test.tsx` (ui), beside the skipped-digest
  line's tests: the line and its age above zero, and nothing at zero.
- Extend the `e2e/desk/operator.demo.spec.ts` demo with seeded overdue
  rows, so the line shows for the demo video.
- Stryker reaches 100% on the touched files.

## Open questions

Answered by the owner, 2026-10-31:

1. **A line, not a fourth figure**: the conditional line above.
2. **Copy**: as proposed. "Running behind" and "queued jobs"; "outbox"
   stays internal.
