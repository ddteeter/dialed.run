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
untracked). **Round 54 · 168.3 (#622) ruled the wide pages mid-lane** and
replaces the guesses this doc first carried: Runners, Codes and Review fill
the width beside the rail (up to MEASURE.page), each a table with a sticky
detail pane, and every cell holds one line.

- **Frame:** `Page` gains `width="table"`. `DeskShell` gives it to Runners,
  Access and Review, and the column to the rest. The 1280 and 320 values
  collapse to `desk` and to a 2fr/1fr track (recorded in design-deltas).
- **`DeskRunners.tsx`** (G-01, N3-01, P3-06, P3-08, N3-02, N3-06, G-09,
  G-10, N3-05, G-11, G-12, P3-07):
  - Cells are one line each. Handles and emails truncate, with the whole
    value in a title and in the pane. Numbers right-align. The ISO date
    is MONO.md.
  - The pane opens on `@handle`, the email, the state and the counts.
    The picked row takes the board's fill and hi-viz bar.
  - At 390 (a guess): the email sits under the handle, and Joined and Runs
    are left to the pane.
  - Filters per round 28 #8: whole-table counts on each, and the current
    one marked. The meta line is `N ACCOUNTS · NEWEST FIRST`, or `N MATCH
IN …`.
  - Empty states: round 28 #8's words, and "Nobody in {Filter}." (owner,
    2026-11-12).
  - Reopen is the chalk pill, and the close form passes `labels`.
  - `accountCount` takes `listAccounts`' `only`, and `runnerCounts` reads
    each filter's own condition.
- **Review** (`ReviewQueue`, `RemovalRequests`, `CopyrightHolds`,
  `QuarantineRecords`, `ReleaseHolds`, `PhotoMatches`, `Takedown`): G-07,
  G-08, N3-10, N3-13, P3-01, P3-03, P3-05, G-13 (Desk half), G-15, G-16,
  G-19, G-22.
  - The list drops its own count, and the heading refreshes after a decision.
  - Titles are one line (`min-w-0 truncate`, whole in a title), and the
    tags take `shrink-0 whitespace-nowrap`.
  - The statutory line moves under the reason.
  - The failure band goes above the action bar.
  - A reported quarantine record drops its form.
- **`DeskAccess.tsx`** (N3-07, N3-09, G-09/N3-06, G-15):
  - Codes are one grid with a subgrid per row, one line a cell, and no pane
    (none is drawn). On a phone the rows wrap.
  - Requests keep the 620 column, and their emails wrap.
  - The page gets one `Access` h1, with its sections as h2s.
- **`Today.tsx`** (G-15, G-21, N3-14): Gave up is uppercase, Raw error uses
  the ▸ text mark, the gaps are even, and the rule moves onto the list.
- **`DeskCorrections.tsx`** (G-20, N3-15): NOW and SUGGESTED keep one layout.
  The refusal becomes a `NOT APPLIED` band (owner, 2026-11-12), and pressing
  Decline clears it.
- **`DeskKit.tsx`** (G-18): one bordered band, the handle in its own case,
  the run line muted and close under it, and the back link underlined.

**Left to other lanes or later:** Review's kit in the pane (#644), Drop's
alignment (it waits on 7b's `PendingLabel` `align` prop), pickers (166), which primary button (167), P3-02 and the ListSection half of
G-13 (7b), and the search field's cancel glyph (7b).

## Contract touches

- Schema changes needed: **none**
- New route files: **none** (`routes/desk/runners.tsx` reads the new counts)
- New bindings/queues/crons: **none**
- Screens: D1 Review, D7 Access, D8 Runners, Desk Today, Corrections, the kit
  view. Design deltas: the 168.3 build record, with its two collapses and the
  390 guesses.

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
- `test/safety/moderation-actions.test.ts` (worker): `runnerCounts` against
  a seeded table, each count equal to its filter's list.
- The existing dom tests for review-queue, desk-corrections, desk-kit and
  today, and DeskAccess: extend them for each moved or conditional element
  (the quarantine form, the band's placement, the refusal band, the list
  count).
- Screen-reader transcripts change where the order or the words change. Only
  my own hunks get regenerated.
- A fresh audit capture after the fixes, compared with the before shots.

## Issues

- Closes: #627 (any finding left undone is moved to a new issue).
- Refs: #622 (168.3 is built here; 168.1–168.2 stay for wave 8).
- Opens: #644, Review's row opening the kit view in the pane.

## Open questions

- The 390 layouts of Runners and Codes are guesses, since 168.3 doesn't
  draw 390.
