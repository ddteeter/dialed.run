# Design: 222 the Desk's Round 58 rulings

## Problem

Round 58 answered nine Desk questions (#719–#725, #758, #759). Each ruling
is a comment on its issue, and the board is `design/Round 58 Rulings.dc.html`.
Most of them are small class changes. The rail's width is the only layout
change: the rail stops being content-sized and takes MEASURE.rail.

## Approach

By ruling (files in parentheses):

- **274 #719** (`safety/ReviewQueue`): below `desk` the row head wraps instead
  of cutting. Line one is `KIND · id`, line two `@owner [SOURCE]`, each item
  kept whole by `whitespace-nowrap` in inline flow (not flex, so the spaces
  stay in what is heard). The clock and fold mark sit top right
  (`items-start`), at line one. From `desk` the head is one cut line, as now.
  The ` · ` before the owner is drawn only from `desk`, and is heard at every
  width (`sr-only desk:not-sr-only`).
- **275 #720** (`ReviewQueue`'s `ReportedPhotos`): the first photo is
  `w-full h-auto`, so it fills the photo column at its own ratio. The rest
  are `size-24` squares, `object-cover`, in a wrapping row 8 apart. A garment's
  single photo is unchanged.
- **276 #721** (`safety/DeskRunners`, `ui/DeskDetail`): below `wide` a state
  tag may wrap inside its cell (`wide:whitespace-nowrap`). DeskDetail's idle
  line is `hidden desk:block`, so it shows only where a pane stands beside
  the table, for Codes too.
- **277 #722** (`DeskRunners`): the search field holds to `max-w-column`. The
  filters stay as text links.
- **278 #723** (`safety/DeskCorrections`): a Corrections card takes
  `RECORD_PANEL` (197's round card). Holds and quarantine records already
  took it in #700. The pane's forms stay square.
- **279 #724** (`account/DeskAccess`): "Requests" becomes the muted kicker,
  Review's, as one `h2`: `Requests · N waiting · oldest first`. The separate
  count line goes, and no words are lost. **Guess:** the kicker keeps "oldest
  first".
- **280 #725** (`account/DeskCodes`): "+ N more" is the Desk's link: ink,
  600, underlined (Corrections' "N more runners" classes).
- **312 #758** (`ops/DeskShell`): from `wide` the bar's content, the rail
  and the page are one group inside the centred `max-w-page` and its 24
  gutters (R57·263's one content edge, x=74 at 1280). The rail is `w-rail`
  (122) on that edge, and the page's own 24 is the gap, so every heading
  sits at x=220 at 1280 and at 170 below 1228, whatever the footer holds.
  The footer stacks `LAST DIGEST` over the time in tabular mono, and
  `NotYetRoom` goes. Entries indent 12 inside the rail, so the current
  entry's bar sits on the edge. Below `wide` the rail is still the sticky
  row. The measure comes from #777's `--container-rail`, so this rebases
  on it, and it lines up with 11c's #708 (bar and `Page` gutters).
- **313 #759** (`safety/CopyrightHolds`): already built as ruled (`w-fit`,
  native date field). The comment that called it a guess now cites 313.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**
- Screens: D1 Today (rail), D2 Review, Corrections, D7 Access, Codes, D8 Runners

## Test plan

- vitest ui (`*.dom.test.tsx`), one assertion per class a mutant could flip:
  the head's two parts and their classes, the photo sizes, the state tag's
  wrap, the idle line's `hidden desk:block`, the search's `max-w-column`,
  Corrections' round card, Access's kicker text and level, Codes' link
  classes, the rail's `w-rail` and its stacked footer.
- e2e: existing Desk journeys. Transcripts are re-recorded where the heard
  text changes (Access's heading, the rail footer). No new spec.
- Visual check at 390 and 1280 with the `styling-audit` capture, for 274,
  275 and 312.

## Issues

- Closes: #719, #720, #721, #722, #723, #724, #725, #758, #759
- Opens: none expected

## Open questions

- 279: whether the kicker keeps "oldest first" (guess: yes, in one line).
- 274: the board draws closed rows wrapping too. The closed row's summary
  line stays one cut line under the head.
