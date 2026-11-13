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
- **Feed:** the run strip's divider is the board's "|" in the strip's
  mono, on a centred row, and each part is a cell of the strip, as the
  board's are (E1's conformance spec counts them); the
  distance is spaced "5.0 mi" through `measuredLine`'s existing `spaced`
  part, so `formatDistance` is unchanged (E1-08). `SpokenDistance` draws
  it for the card and A2's rail. **The card's credit is Design 170's
  label** (#624): `WeatherAttribution isCompact` draws "VISUAL CROSSING"
  heard by D-144's sentence, lying over the strip's right end, and the
  strip keeps that room with an unseen copy of the label. The sentence
  line under each card goes. Both tabs carry a 2px bottom border,
  transparent when resting (E1-16a). The "Meanwhile" link is underlined
  (P2b-07). The teal band is a rounded card at every width, as Design
  170's board draws it at 390 (this supersedes N2-11's full-bleed
  reading), and the place line loses its extra top padding.
- **Columns:** G, H, "isn't here" and search step up to `wide:px-6`, as
  Feed does (E1-09). Search's title sits in a 44px row, as Feed's does
  (P2b-12). Its "[ Searching ]" label is mounted only while a search is
  out, so it reserves no width (E2-05); 7b's base rule in `src/styles.css`
  hides the native cancel glyph on every search field. H's place line can wrap (P2b-06). The Following
  pill's outline is 1px `--ink` (R48·134, E1-16b).
- **BracketHeadline:** inline text with `mr-2`/`ml-2` brackets and no
  whitespace between a bracket and its word, as 7b's `PendingLabel`
  pending layer (E1-06).
- **Useful:** neither heart is in the shipped Plex Mono subset, so each
  fell back to a different system face. The outline is now the same "♥"
  with a 1px stroke and no fill (E2-08). The indent takes 7b's
  `PendingLabel` `align="start"` (E1-07, N2-09).
- **Phone bell (Design 169, #623):** 7b seats `PhoneBell` in Feed, G, H,
  D, search, A2 and A3 itself, so its R-102 conformance test is green on
  its own PR; this lane rebases onto it and keeps 7b's seat.
- **Public pages (PublicFrame, PublicProfile):** the bar is an ink block
  (`data-ground="ink"`, a panel in dark), and Log in is a 1px `--ink`
  outline on it (E2-06). Desk rows are `auto 1fr`, so the invite follows
  the kits and the rail's height doesn't stretch row 1 (N2-17). Only a
  retired piece's name is struck through (N2-19). The pitch says "Request
  access" (#612). The footer's gaps match 7b's `Layout` fix (A-03).
- **Handles:** H's report subject is labelled with `handleText`, so the
  foot link reads "Report or block @x" (E1-12). On a profile, W1's title
  is "Report @x?" (owner, 2026-11-12). The line repeating the handle goes,
  and "@x is never told who reported it." takes its "@".

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

- Closes: #628 (less what 7b holds), #612, #624, #641, #642.
- Refs: #632 (the feed-origin findings, ticked "done in 7d").
- Opens: #645 (AF1's 90ms cross-fade needs a motion surface; the swap is a
  cut until then).

## Open questions

- **Settled by Round 55:** R55·171 (#641) draws the owner's "Not copied":
  the rest look (hairline edge, no fill) for 2000ms, heard as "Link not
  copied.", so the rest pill's edge is a hairline too, superseding round
  41's ink one. R55·172 (#642) confirms all three tags in every state.
- Wave 8 (Round 54): 166.4 (the audience picker as one card with ink
  rings, MONO.sm caps at 400), 166.6 (W1's block option as "Send and
  block"), 167 and 168.
