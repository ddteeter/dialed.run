# Design: 207 The Desk's styling-audit fixes (#627)

## Problem

The 2026-11 styling audit found 32 built-wrong things on the operator Desk.
The worst is Runners (D8): at desk width its table runs its columns together
and its panels squeeze into a strip, and on a phone half the table is out of
reach. Review, Access, Today, Corrections and the kit view have smaller
overflow, alignment and hierarchy bugs. This lane fixes each one where it
starts, at today's page width.

## Approach

Each finding is checked against a fresh capture first (audit capture copied in,
untracked). Fixes, by file:

- **`DeskRunners.tsx`** (G-01, N3-01, P3-06, P3-08, N3-02, N3-06, G-09, G-10,
  N3-05, G-11, G-12, P3-07):
  - Cells are padded and don't wrap their date, counts or state. The date is
    `SEP 02` (`monthDayLabel`, as the board writes it).
  - **Guess, pending Design 168:** Handle and Email share one cell, with the
    email under the handle, so the table fits in 620px and in 390px.
  - **Guess, pending Design 168:** the picked runner's panels open as a
    full-width row under that row, as Review's rows do. The panels start
    with the board's `@handle` and `JOINED · RUNS · REPORTS ON NAME`. The
    picked row takes the board's fill and hi-viz bar.
  - Filters per round 28 #8: whole-table counts on each, and the current one
    in ink, semibold and underlined. The meta line reads `N ACCOUNTS · NEWEST
    FIRST`, or `N MATCH IN REPORTED` when a search or filter is on.
  - The no-match row uses round 28 #8's words. An empty filter reads
    "Nobody in {Filter}." (owner, 2026-11-12).
  - Reopen account becomes the chalk pill.
  - The close form passes `labels`.
  - `runners.ts` adds `runnerCounts`, one `$count` per filter, built from the
    same `filterSql` table.
- **Review** (`ReviewQueue`, `RemovalRequests`, `CopyrightHolds`,
  `QuarantineRecords`, `ReleaseHolds`, `PhotoMatches`, `Takedown`): G-07,
  G-08, N3-10, N3-13, P3-01, P3-03, P3-05, G-13 (Desk half), G-15, G-16,
  G-19, G-22.
  - The list drops its own count, and the heading refreshes after a decision.
  - Titles take `min-w-0 wrap-anywhere`, and the tags `shrink-0
    whitespace-nowrap`.
  - The statutory line moves under the reason.
  - The failure band goes above the action bar.
  - A reported quarantine record drops its form.
- **`DeskAccess.tsx`** (N3-07, N3-09, G-09/N3-06, G-15):
  - Code rows share one subgrid at desk, and stack on a phone.
  - Emails wrap.
  - The page gets one `Access` h1, with its sections as h2s.
- **`Today.tsx`** (G-15, G-21, N3-14): Gave up is uppercase, Raw error uses
  the ▸ text mark, the gaps are even, and the rule moves onto the list.
- **`DeskCorrections.tsx`** (G-20, N3-15): NOW and SUGGESTED keep one layout.
  The refusal becomes a `NOT APPLIED` band (owner, 2026-11-12), and pressing
  Decline clears it.
- **`DeskKit.tsx`** (G-18): one bordered band, the handle in its own case,
  the run line muted and close under it, and the back link underlined.

**Left to other lanes:** the page width and the side column (Design 168),
pickers (166), which primary button (167), P3-02 and the ListSection half of
G-13 (7b), and the search field's cancel glyph (7b).

## Contract touches

- Schema changes needed: **none**
- New route files: **none** (`routes/desk/runners.tsx` reads the new counts)
- New bindings/queues/crons: **none**
- Screens: D1 Review, D7 Access, D8 Runners, Desk Today, Corrections, the kit
  view. Design deltas: the two Runners guesses above, for 168.

## Test plan

- `test/safety/desk-runners.dom.test.tsx` (ui):
  - the counts on each filter;
  - the current filter's state;
  - the meta line;
  - both empty states;
  - the picked-row mark;
  - the panel header;
  - Reopen as a button with the pill class;
  - the close form's labels.
- `test/safety/runners*.test.ts` (worker): `runnerCounts` against a seeded
  table, one row per filter.
- The existing dom tests for review-queue, desk-corrections, desk-kit and
  today, and DeskAccess: extend them for each moved or conditional element
  (the quarantine form, the band's placement, the refusal band, the list
  count).
- Screen-reader transcripts change where the order or the words change. Only
  my own hunks get regenerated.
- A fresh audit capture after the fixes, compared with the before shots.

## Issues

- Closes: #627 (any finding left undone is moved to a new issue).
- Opens: whatever 168 leaves for Runners' wide layout, if it isn't already
  covered.

## Open questions

- The two Runners guesses go to Design 168 through coordinator-7.
