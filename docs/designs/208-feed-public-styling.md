# Design: 208 Feed and public pages: styling fixes (wave 7, lane 7d)

## Problem

The 2026-11 styling audit found feed, profile, entry detail, search and
public-page screens drawn differently from their boards (#628), plus the
feed-origin half of the shell findings (#632). Round 53 · 163d also renames
the public pitch's "Request an invite" to "Request access" (#612). Each
finding is confirmed against a fresh capture before it is fixed.

## Approach

Fix each finding at its origin, all in `src/modules/feed/**`, its routes
and `ReportAffordance`:

- **D (EntryDetail, RetractEntry, OwnerAudience):** YOURS takes the
  column's 16px above its rule (E2-04, N2-05). The back chevron is pulled
  onto the gutter (E2-12). The owner meta is drawn as round 41 draws it:
  three audience tags with the current one in ink, the sentence in body ink,
  an outlined **Copy link** pill and a **Change** link (N2-06). Copy link
  confirms as AF1 does: for 2000ms it reads "Copied" with an ink fill, and
  keeps its name (P2b-01).
- **Feed:** the run strip's divider is centred and uses the mono step, and
  the distance is spaced "5.0 mi" through `measuredLine`'s existing
  `spaced` part, so `formatDistance` is unchanged (E1-08). Both tabs carry
  a 2px bottom border, transparent when resting (E1-16a). The "Meanwhile"
  link is underlined (P2b-07). The teal band bleeds to the screen edge
  below `desk`, and the place line loses its extra top padding (N2-11).
- **Columns:** G, H, "isn't here" and search step up to `wide:px-6`, as
  Feed does (E1-09). Search's title sits in a 44px row, as Feed's does
  (P2b-12). Its field hides the native cancel glyph, and so does
  KitPicker's (E2-05). H's place line can wrap (P2b-06). The Following
  pill's outline is 1px `--ink` (R48·134, E1-16b).
- **BracketHeadline:** no flex gap; the brackets hug the words when they
  wrap, using the mechanism 7b builds for `PendingLabel` (E1-06).
- **Useful:** both hearts render the same size from one face (E2-08). The
  indent waits on 7b's `PendingLabel` `align` prop (E1-07, N2-09).
- **Public pages (PublicFrame, PublicProfile):** the bar is an ink block
  (`data-ground="ink"`, a panel in dark), and Log in is a 1px `--ink`
  outline on it (E2-06). Desk rows are `auto 1fr`, so the invite follows
  the kits and the rail's height doesn't stretch row 1 (N2-17). Only a
  retired piece's name is struck through (N2-19). The pitch says "Request
  access" (#612). The footer's gaps match 7b's `Layout` fix (A-03).
- **Handles:** H's report subject is labelled with `handleText`, so the
  foot link reads "Report or block @x" (E1-12).

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens: D, E1, E2, G, H, I (search), the public kit and profile pages.
  Design-deltas lines go under round 41 #86a/#86c and AF1.

## Test plan

- `*.dom.test.tsx` (ui) for each changed component: the class or the
  structure that carries each fix (the tags, the Copied swap and its revert
  on fake timers, the failure path, the struck name only, the transparent
  resting border, the spaced distance), each written to fail on its
  mutant.
- The public-pages journey, its transcript and the component test for
  "Request access".
- e2e transcripts regenerate where the owner meta and the report link
  change (CI-style run).

## Issues

- Closes: #628 (less what 7b holds and the Round 54 items), #612.
- Refs: #632 (the feed-origin findings, ticked "done in 7d").
- Opens: whatever doesn't reproduce or lands with another lane.

## Open questions

- **Guess:** a refused copy shows "Not copied" on the pill for 2000ms,
  with no ink fill. AF1 draws only success. Sent to coordinator-7.
- **Guess:** the three audience tags show in every state, not only PUBLIC.
  Round 41 draws only PUBLIC.
- E1-12's other half (the sheet's "entry?" title on a profile, and its
  bare handle) is in `ReportSheet`, outside this lane.
