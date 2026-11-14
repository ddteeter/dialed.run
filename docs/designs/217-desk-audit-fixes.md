# Design: 217 the Desk's styling-audit fixes (#700)

## Problem

The styling-audit re-run (#666) left 13 built-wrong findings on the Desk.
The worst is R2-DESK-01: on a phone, one long code label widens the Codes
list past the screen, and the shell stops sideways scroll, so the cut ends
cannot be reached. The rest are spacing, edge and theme leftovers. Each
finding is confirmed against a fresh capture (skill `styling-audit`) before
it is fixed. A finding already right on main is ticked, with a note saying so.

## Approach

By finding (files in parentheses; ★ = outside this lane, awaiting the coordinator):

- **R2-DESK-01** (★`ui/DeskDetail`, ★`account/DeskCodes`): the table's track
  is `minmax(0,1fr)` below `desk`, not an implicit `auto`, so the list is as
  wide as the screen and a label's `truncate` cuts it there.
- **R2-DESK-03** (★ the same files): handles and "+ N more" take `target-line`
  (the 44 hit area without the 44 height), so a wrapped line is a text line.
  Codes passes an `idle` line, so the pane's track holds something while
  nothing is picked. If the board's full-width table needs the pane's track
  dropped while idle, that is a `DeskDetail` option (`idle` absent ⇒ one track).
- **R2-DESK-02** (★`styles.css`): the `dark` custom variant also matches
  inside `[data-ground="night"]`, because T3 says the Desk is night for
  everyone. Sheet's drawer edge and form's `--hairline-2` field edge then
  follow the ground, not the runner's theme, with no change in
  `Sheet`/`form`.
- **R2-DESK-04** (★`ui/DeskDetail`): in the drawer, the detail sits in a
  `flex flex-col gap-4` wrapper, the pane's own gap.
- **R2-DESK-07** (`safety/ReviewQueue`): the text column is `col-start-2`
  only when the photo cell has content; otherwise it spans both columns.
- **R2-DESK-08** (`safety/DeskForm`, `CopyrightHolds`, `QuarantineRecords`):
  holds and quarantine records use 197's card: `rounded-card`, a `RowHead`-
  shaped head in ink (`KIND · short id · @owner [TAG]`, date muted), hairlines
  around the body, and `ListSection hasCards`.
- **R2-DESK-10** (`ops/Today`): the flagged link drops `target inline-flex`.
  The stretched `after:` already covers the card.
- **R2-DESK-11** (`safety/PhotoMatches`): the match grid becomes a grid of
  fixed tile columns, as 198's other-photos grid is. Captions wrap or cut
  within the tile, and the owner link is `target-line`.
- **R2-DESK-12** (a) ★`auth/SignOutButton`'s Desk variant aligns its pending
  label to the start. (b) `ops/DeskShell`'s rail takes design 210's 200
  width as a token class. (c) `safety/Takedown`'s kicker is `text-muted`.
  (d) a profile row's head reads `@handle`.
- **R2-DESK-13** (`safety/DeskKit`): the band gets `py` so every line has room,
  and its handle link is `target-line`.
- **G-10** (`safety/DeskRunners`): the search becomes the form contract's
  field (`TextField`, `--panel`).
- **P3-02** (`safety/CopyrightHolds`): "Received on" is a short field.
  **Guess:** the date's display format is the browser's own for a native
  date input, so "Oct 24, 2026" goes to the coordinator as a Design question
  and is not built here.
- **N3-16** (`safety/DeskDuplicates`): the count sits beside the heading, as
  in Review.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**
- Screens: D1–D8 (`/desk/**`); design-deltas entries for any guess

## Test plan

- vitest ui (`*.dom.test.tsx`), one assertion per class change that a
  mutant would flip: DeskDetail's tracks, idle line and drawer gap; Codes
  rows' `target-line`; ReviewQueue's no-photo span; record card classes and
  head text; Today's link classes; PhotoMatches' grid; Takedown's muted
  kicker; profile head's `@`; DeskKit band; Runners search is a `TextField`;
  Duplicates' count beside the heading.
- R2-DESK-02: a ui test that a `dark:` class applies under
  `[data-ground="night"]` cannot run in happy-dom (no CSS). A browser-project
  test (`*.browser.test.ts`, Chromium) reads the computed border colour of
  a field inside a night ground with the root pinned light.
- e2e: the existing Desk journeys' transcripts are re-recorded where a head
  changes (profile `@`, record heads). No new spec.

## Issues

- Closes: #700
- Opens: anything deferred (listed in the PR)

## Open questions

- ★ items wait on the coordinator's ownership answer.
- P3-02's date format (above).
