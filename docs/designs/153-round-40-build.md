# Design: 153 Round 40's build (C1, C2, C4, C5)

## Problem

Design round 40 (`design/Round 40 Rulings.dc.html`, text of record in
`design/docs/product.md` § Round 40) answered item 82 and five asks carried
from items 39, 36, 38 and the round-30 errata. Item 82 is built (PR #224)
and C3, the content-removed email, belongs to the C8 follow-up after
PR #220. This lane imports the round and builds the rest.

## Approach

1. **Import.** `docs/design-deltas.md` gains "Answered in round 40"; the
   open queue marks what round 40 settles in items 36, 38 and 39. `design/`
   takes the round's three changed files (the board, Form Contract §02b,
   product.md). The Garmin files in the same zip are not this round.
2. **C1 · Google delete** (`account/components/DeleteAccount.tsx`,
   `Leaving.tsx`, `ActionCard.tsx`). Back from Google the sheet opens with no
   message and focus on "Delete my account" (today: "Keep it"); it still
   never submits by itself. Keep pressed after the purge has begun: the §4a
   band `NOT KEPT` · "Your account is already being deleted. It can't be
   kept now.", with no Try again, and Keep my account leaves; Log out stays.
   `ActionCard` takes an optional refusal for that, so `TermsPrompt` is
   untouched.
3. **C2 · emails** (`email/content.ts`, the invite and Strava templates
   only). Invite foot: "Sent because this address asked for access. Didn't
   ask? Ignore this; nothing happens." Strava's body loses "Your runs here
   haven't changed." Deletion date and digest are confirmed as built: every
   deletion day goes through `proseDayLabel` with no zone (UTC), and the
   digest is from `hello@`, its third number `bansThisWeek`.
4. **C4 · F's rail card** (`closet/components/AlreadyInCloset.tsx`,
   `ui/DeskSplit.tsx`). The strings and the type narrowing are already
   built, and there is no "no card before a category" code to delete. What
   differs is the face: the board draws the heading in TYPE.heading,
   sentence case, and the empty line in TYPE.body, `--quiet`; the build has
   a MONO.xs caps title and a TYPE.small `--label` line. `RailCard` gains a
   `heading` title face; the other rail cards keep theirs.
5. **C5b · feed divider** (`feed/components/Feed.tsx`, `PostCard.tsx`).
   Posts are divided by a 1px `--hairline` across the column
   (`divide-y divide-hairline`), each post `py-4` (SPACE[4]); the gap
   between posts and the post's own `border-b pb-5` go. C5a needs nothing.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**
- Screens: U1 delete sheet, Delete pending / pending sign in, F at desk, E1.

## Test plan

- dom: `deletion-pages.dom.test.tsx` — the return focuses Delete my account,
  shows no message and sends nothing; too-late shows NOT KEPT, no Keep, no
  Try again, Log out still works, the status says it.
- dom: `already-in-closet.dom.test.tsx`, `desk-split.dom.test.tsx` — the
  heading face; `feed.dom.test.tsx` — the divider and SPACE[4].
- worker: `test/email/render.test.ts` — the invite foot and Strava body.
- Stryker on every changed `src` file; demos for delete and the feed.

## Open questions

- "Full width" (C5b): the board's frame is a phone with no side gutter of
  its own; the build divides across the feed column, not past the shell's
  screen-edge gutter. Proceeding on the column.
- C1's band removes the focused Keep button; focus is left to the status
  announcement (the ruling names no target).
