# Design: 216 the desk drawer says the picked name once (#663), plus #393 and #390

## Problem

Below desk (R55·202), a picked runner or code opens in the desk drawer, a
non-modal `Sheet` named for it. The Sheet draws its own title from that name
(R55·173: the sheet owns its heading), and the detail inside opens with the
same name again: Runners' `RunnerHead` as a bold line, Codes' `CodePane` as
an `h2` in mono. So the drawer shows "@handle" or the code twice, and a
screen reader hears it twice in a row. At desk the detail sits in an `aside`
named by `aria-label`, so its own name line is the only one there.

## Approach

Keep the Sheet's title, and drop the detail's name line inside the drawer.

- `src/ui/DeskDetail.tsx` puts the drawer's detail in a context that says
  "this is the drawer", and exports `DeskPaneName`: a wrapper that renders
  its children in the desk pane and nothing in the drawer.
- `DeskRunners`' `RunnerHead` wraps the handle line in `DeskPaneName`;
  `DeskCodes`' `CodePane` wraps its code `h2` the same way. The rest of each
  head (email, state tags, counts; label, used line) stays in both places.
- One rule, owned by the component that decides drawer vs pane, so a third
  Desk table would get it by using `DeskPaneName` rather than learning the
  breakpoint.

Why not the other way round (the Sheet takes no visible title and is
labelled by the detail's heading): it undoes R55·173 for one caller, it needs
a new mode in `Sheet.tsx` (9a's file this wave), and Runners' name line is
not a heading, so there would be nothing to label the drawer by.

**Guess, Design 251 (#667, Round 57):** the drawer's title then shows a code
in the Sheet's display type, not mono; mono stays in the wide pane. If Design
rules mono there, that is a `Sheet` title change for 9a, not this lane.

## Added: #393, D8's hairline before CSAM

Round 39 #76 draws D8's rule select as the terms' ten rules, a hairline,
then "Suspected CSAM (the notice names no rule)"; design-deltas 76 says
the shared `ChoiceField` drew no hairline. `ChoiceField` gains an optional
`hairlineBefore` option, rendered as a native `<hr>` inside the `<select>`
(the platform's own separator, no new style), and `PickOne` passes it
through. Close account sets it to `suspected_csam`.

## Added: #390, D2 says when it stopped at the cap

`duplicateProducts` reads one row past its limit and returns
`{ candidates, cutAt }`: `cutAt` is the limit it used when the catalogue
ran past it. `duplicatesReport` carries `cutAt`, and D2 says, under its
intro, only when cut (the owner's wording, 2026-11-13, recorded on #390):

> Read the first 500 products only. Near-misses past them aren't shown.

and its empty line becomes "No near-misses in the first 500 products."
The number is `cutAt`, so it is always `DUPLICATES_PRODUCT_CAP`'s.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**
- Screens: Desk Runners and Codes below `desk` (R55·202, R56·243)

## Test plan

- `test/ui/desk-detail.dom.test.tsx` (vitest ui): `DeskPaneName` renders its
  children in the pane and nothing in the drawer, so the drawer has one
  heading and the pane keeps its name line.
- `test/safety/desk-runners.dom.test.tsx` (vitest ui): below desk, the picked
  runner's handle appears once in the drawer, as its title.
- `test/account/…` Codes test (vitest ui): below desk, the picked code is the
  drawer's only heading.
- Transcripts: no e2e opens the drawer, so none change for #663.
- #393: `test/ui/form.dom.test.tsx` (the `<hr>` sits before the named option
  only, and nowhere unless asked); `desk-runners.dom.test.tsx` (the CSAM
  option is last, after the one hairline). Desk e2e transcripts that read
  the rule select may gain a separator line.
- #390: `test/safety/duplicates.test.ts` (worker: `cutAt` at and past the
  cap and for a given limit; D2's lines rendered from a real cut read
  contain `DUPLICATES_PRODUCT_CAP`); `desk-duplicates.dom.test.tsx` (the
  cut line, the scoped empty line, nothing when whole).

## Issues

- Closes: #663, #393, #390, #689
- Opens: none expected

#689 joined late. This PR's first CI e2e failed the accessibility coverage
figure at 77.15% against a 77.44% baseline, 0.04 past `FIGURE_NOISE`. Main's
own runs spread 0.31 points, so the owner widened `FIGURE_NOISE` from 0.25
to 0.4 and kept the baseline (2026-11-14). The judge test's failing case
moves from 49.7% to 49.5%, so it still observes the band.

## Open questions

- Code in display type in the drawer title: Design 251 (#667). Proceeding
  on the guess above.
