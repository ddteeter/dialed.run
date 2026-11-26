# Design: 267 each email's words with its sender

> Design 261 §D, row D3 (#1050), from the owner's ruling 14. A design and
> one question. Nothing is built until the owner rules. Behaviour-neutral:
> no word any email says changes. Over the template's page by its
> measurement tables.

## Problem

`src/modules/email/content.ts` (616 lines) holds every email's words: 22
kinds sent from five modules. A pull request that changes what an email
says changes `email` too, so it crosses modules. Design 260 finding 4
named this the one cause of crossing with a count behind it. The owner
asked how the words could sit with their sender.

**Measured again at `740f4f852`**, the way design 260 did it (first-parent
merges, non-test files under `src/modules`, merges over six modules left
out):

| merges that changed `email`                        | 43  |
| -------------------------------------------------- | --- |
| ... and another module                             | 35  |
| ... where the only `email` file was `content.ts`   | 20  |
| ... of those, adding a kind                        | 4   |
| ... of those, one module once `email` is set aside | 1   |

Design 260 had 28 and 16 at its pin; the four takedown merges since
(#1020, #1031, #1034, #1040) are all of this kind. The last row is the
honest size of the gain: `email` leaves 20 crossing merges, but 19 of
them still cross, because takedown and moderation work spans `safety`,
`feed` and `ops` anyway. Only #312 (the digest's outbox line, `ops`)
becomes one module.

## Who sends what

Read from `kind: "…"` literals in `src`:

| sender (sub-module)    | kinds                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `account/verification` | `verify_email`, `existing_account`, `reset_password`, `email_change`, `email_changed` |
| `account/access`       | `access_confirm`, `invite`                                                            |
| `account/data`         | `deletion_scheduled`                                                                  |
| `account/export-build` | `export_ready`                                                                        |
| `runs/strava`          | `run_reminder`, `strava_disconnected`                                                 |
| `feed/moderation`      | `content_removed`, `removal_request_decided`                                          |
| `safety/runners`       | `account_closed`, `account_reopened`                                                  |
| `safety/reports`       | `removal_due`                                                                         |
| `safety/takedowns`     | `removal_requested`, `removal_request_received`, `takedown_valve`                     |
| `ops/daily`            | `digest`, `removal_reminder`, `removal_reminder_summary`                              |

Every kind has one sending sub-module. Three helpers serve more than one:
`logIn` (account, `safety/runners`), `utcMinute` (`safety`, `ops/daily`)
and `brokeRule` (`feed/moderation`, `safety/runners`). The footer
(`legal`) and the assembly (`emailContent`) are every email's and stay in
`email`.

## Approach (the options)

**Why there is plumbing at all.** `email` renders at send time, and the
outbox drain (`ops/owed-email`) renders any kind. Neither can import the
senders: they import both. So a sender's words must be handed in. Only
`dispatch` sits above every sender. Nine call sites settle an owed email
on a fast path (`settleOwedEmail`, and `owedEmailHandlers` in
`feed/entries/retract.ts`), and six calls in two `account` files send now (`deliverEmail`).

1. **Words in the sending sub-module, composed in `dispatch`.** Each row
   above gets an `email-words.ts` exporting its kinds' words, typed
   `EmailWords<K>`. `dispatch/email-words.ts` composes
   `{ [K in EmailKind]: EmailWords<K> }` and hands it to the drain's
   handler. A fast path or an immediate send hands in its own
   sub-module's words, typed by the kind it sends, so a missing entry is a
   compile error, never a send deferred to the drain. `renderEmail`,
   `deliverEmail`, `deliverOwedEmail`, `emailHandler`, `settleOwedEmail`
   and `owedEmailHandlers` take the words. The type and the three shared
   helpers go to `src/lib/contracts/email.ts` and
   `src/lib/contracts/email-words.ts`, so no sender gains an import of
   `email` (B12 removes most).
2. **Words beside the kind, in `src/lib/contracts/`.** One file per row
   above, read by `email`'s `CONTENT` as today. No plumbing, no door
   change. Removes the same 20 crossings, and a new kind crosses nothing.
   But the words are owned by no module: `lib` is shared by everyone.
3. **Split `content.ts` inside `email`**, one file per sender. Smaller
   diffs and fewer conflicts; the 20 crossings stay.
4. **Leave it.** Close #1050.

A runtime registry (Worker start registers the table) was rejected: tests
do not run `src/server.ts`, and an empty registry fails only at send.

## What each option moves, and the numbers

| number (today, `npm run -s modules:pin -- --print`) | 1                                                                       | 2                           | 3        |
| --------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------- | -------- |
| files `email` (16)                                  | 15                                                                      | 15                          | 20       |
| files of the ten sender sub-modules                 | +1 each, largest `safety/takedowns` 17 (budget 50)                      | none                        | none     |
| door width of the ten sender sub-modules            | +1 each, largest `runs/strava` 25 (budget 45)                           | none                        | none     |
| door `safety` (95, pinned), `account` (35)          | unchanged: `dispatch` imports the sub-module doors (ruling 2)           | unchanged                   | none     |
| door `email` (28)                                   | unchanged (`emailContent` is not on it)                                 | unchanged                   | none     |
| fan-out `dispatch` (11)                             | unchanged: it imports all five senders already; outside the budget (A1) | unchanged                   | none     |
| fan-out of the senders                              | unchanged: the type is in `lib`                                         | unchanged                   | none     |
| a new kind touches                                  | `lib/contracts`, the sender, `dispatch`                                 | `lib/contracts`, the sender | as today |

No pin rises under any option, so `test/architecture/module-shape.json`
does not change.

## Contract touches

- Schema: **none**. Bindings, queues, crons: **none**. Routes: none.
  Screens: none; no word changes (a changed word is a stop).
- **The kinds stay one truth.** `emailTemplateSchema` in
  `src/lib/contracts/email.ts` and the table in `email-kinds.ts` are
  untouched. Option 1's `dispatch` table and option 2's `CONTENT` are
  keyed by `EmailKind`, so a kind without words fails to compile, as
  `CONTENT` and `PREFERENCE_OF` do today. `docs/contracts.md` has no
  email section, so nothing there moves.
- **Mutation ratchet.** `stryker.conf.json` is protected (the
  `owner-approved` label). Under option 1 the ten word files fall inside
  existing sub-module globs, and `content.ts` leaves the
  `src/modules/email/**/*.ts` entry with no edit; the new
  `src/lib/contracts/email-words.ts` needs adding to the
  `contracts/email.ts` entry. Option 2 adds its files to that entry or a
  new one (that shard already ran 101 to 158 minutes, design 198). The
  module-scope tables (`STAYS`, `REMOVED_SUBJECT`, `REPORTED`) are static
  mutants; a lane moves them inside their functions where the safety
  shards would otherwise grow.
- **Protected tests.** `test/architecture/contact-addresses.test.ts:42`
  names `src/modules/email/content.ts` as a reader; the path changes.
- **Diagrams.** `docs/diagrams/flows/removals.c4:53` cites `content.ts
receiptBody`; it moves to `safety/takedowns/email-words.ts` (or the lib
  file). No module arrow or sub-module changes, but the lane runs
  `diagrams:generate` and `diagrams:stale`. `docs/architecture.md`'s
  Email paragraph gains a sentence on where the words live.

## Build plan (option 1, one lane, M, after B12)

B12 moves `email/rate-limit.ts` out first; the two touch different files
but both edit `email`'s tests.

1. The type, the shared helpers, `renderEmail(template, links, words)`.
   `test/email/render.test.ts` passes the composed table; not one
   expected string changes. Done: the suite green, the test's diff only
   its imports and call shape.
2. One commit per sender module (account, runs, feed, safety, ops): its
   `email-words.ts`, its door, the `dispatch` table's lines. Done: tsc
   green, render test unchanged.
3. The plumbing: the six functions take words; the drain gets the table
   from `dispatch/outbox-handlers.ts`; each fast path and immediate send
   passes its own. Done: the existing fast-path and drain tests green, no
   new cast.
4. Delete `content.ts`; the contact-addresses path, `removals.c4`,
   `docs/architecture.md`, the `stryker.conf.json` line. Done: full
   `npm test`, `npm run build`, `modules:pin -- --print` as tabled.

## Test plan

- `test/email/render.test.ts` (worker): unchanged expectations are the
  proof of neutrality. No new Playwright spec; emails have no screen.
- Exhaustiveness is the compiler's, as today. One worker test that a fast
  path renders through its own words (account's email change notice),
  since that path is new.

## Issues

- Refs #1050, which the build lane closes. Opens nothing.

## Open questions

**For the owner: where do an email's words live?**

1. **(Recommended) In the sending sub-module, composed in `dispatch`.**
   Each module owns its words; fast paths hand in their own, typed by
   kind. Reason: it is the owner's own reading in rulings 7 and 8 (a
   module holds what is its own), it is the hand-in shape D1 uses, and the
   words sit beside the fields the sender fills, which is what most of the
   20 merges changed together. Cost: six signatures and about fifteen call
   sites, and a new kind touches `dispatch`. Gain: `email` leaves 20
   crossing merges; one becomes single-module.
2. **Beside the kind, in `src/lib/contracts/`.** The same 20 crossings
   gone and no plumbing, but the words belong to no module.
3. **Split `content.ts` inside `email` by sender.** Smaller files; the
   crossing stays.
4. **Leave it**, and close #1050.

## Not checked

- That every fast path's debt carries its kind in its type, which option
  1's compile-time rule needs. If one does not, step 3 types it first.
- Which kinds each of the 20 merges edited was read from hunk headers for
  14 of them, not every line.
- Static-mutant counts per word file were estimated, not run.
