# Design: 238 desk-screening

## Problem

#822: the Desk rail's foot reads `Screening · Holding` when any hold
breaker is over its ceiling this hour, and `Screening · OK` otherwise
(`DeskShell.tsx`, from `deskToday`'s breakers). Every spec that records a
Desk transcript reads that line from whatever the suite's earlier specs
left in the hour, so a change to the suite's order, or to what an earlier
spec seeds, flips it. On main, a failed journey also leaked its seeded hold
into a later journey's Review list, because its cleanup was not in a
`finally`.

## Approach

- **The state word is masked in the transcript** (the chosen approach).
  `normalize()` in `e2e/support/a11y-transcript.ts` already masks what
  differs between runs because other tests' rows decide it: counts, times,
  "2h ago". The breaker's state is the same kind of value, so
  `Screening · OK` and `Screening · Holding` both record as
  `Screening · :state`. The transcript keeps what a screen reader hears,
  in order. The state itself stays asserted where a journey sets it up:
  operator's `Screening · Holding` scene is an `expect`, not a transcript
  line.
- **Desk-seeding journeys clean up in `finally`.** A journey that seeds
  Review rows (holds, reports, screenings) and fails partway left them
  for every later spec. Each one's cleanup moves into a `try/finally`, so a
  failure costs that journey and no other.
- **Not built:** per-journey breaker isolation (a seeded clock or a scoped
  breaker reading). That needs a seam in `src/modules/safety` or
  `src/modules/ops`. The mask removes the order dependence without one.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens: none (test harness only). The recorded Desk transcripts change
  one line each.

## Test plan

- `e2e/support/a11y-transcript.spec.ts`: both states normalize to
  `Screening · :state`, and a "Screening" elsewhere in a sentence is
  left alone.
- The transcripts that record the line are re-recorded from a CI-style
  run and their diff read: only that line changes.
- Full CI-style e2e, `npm test`, lint and typecheck.

## Issues

- Closes: #822.
- Opens: none.

## Open questions

None.
