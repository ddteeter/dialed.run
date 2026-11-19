# Design: 241 The styling tail (what is left of Design 167 and 168)

## Problem

The styling audit (#617) is held open by the last of two Round 54 rules:
one primary button kind per surface with the desk width rule (167, #621),
and the centred 620 column (168, #622). Each has a "what is left" list
taken at main `2a627208`; waves 10 to 14 built part of both. This lane
re-checks every line against a fresh capture of today's main, builds what
is still wrong, and closes all three.

## Approach

A site that is wrong moves onto a shared constant in `src/ui/form.tsx`.
No second hand-written class.

**167, still wrong on main** (each seen in the capture of `418583f9`):

- Pink caps primaries that write their class by hand and so miss the
  width rule take `ACTION_PRIMARY`: the Call's LOG A RUN (`CallLadder`),
  run detail's WHAT DID YOU WEAR? (`RunDetail`), A2's NEXT (`AttachKit`),
  P2.5's NEXT (`NamePieces`) and A1's primary (`ParsedCard`, which hugs
  only from 1040 today).
- Settings › Username saves with the ink pill: `HandleForm` reads its
  tone from `carry`, which already says settings or onboarding.
- R2b's first step and T1's disconnect confirm take `INK_PILL` and
  `SECONDARY_PILL`: stacked in the sheet, a row from 720 on T1's page.
- The photo-refused band's buttons take the failure band's own pill,
  which becomes a constant `FailureBand` and `PhotoRefused` share.
- A2's "Not now" line sits left under the hugging NEXT from 720
  (R58·293), and stays centred on a phone, as drawn.

**167, dropped:** the pushes' DONE (R58·302), the Strava receipt's pill,
OPEN THAT RUN's kind (R58·306), the five phone pills and the 404's
(design 234) are on the constants. CityFinder's pair is exempt by name
(R58·308). ShadeSheet's pink pill waits on Design 334 (#834, then #835).

**168, still wrong on main:**

- A1 becomes `Page`'s centred 620 with the conditions block in the
  column, in phone order (R55·233). `AddRunShell` and `ParsedCard`'s desk
  grid go; the well and the duplicate receipt sit in the same column, so
  D1-06 goes with them.
- The root crash is the last `Page width="panel"`. R55·185 gives a system
  state "the 620 column elsewhere", so it takes the column and `panel`
  leaves `Page`.
- Found in the capture: A2 and A3's column keeps the phone's 20 inside
  it from 720, so it starts at x=188 and holds 580. It drops that gutter
  (R57·263) and starts at R58·307's x=168.

**168, dropped:** A2, A3 and the pushes (R58·307 keeps the rail, built);
the signed-in system states (#697, built).

## Contract touches

- Schema changes needed: **none**
- New route files: none (`src/routes/runs/new.tsx` swaps its shell for `Page`)
- New bindings/queues/crons: **none**
- Screens: A1, A2, R2, R2b, T1, P2.5, the Call, Settings › Username, F's
  photo band, X2's root crash. One "Built" section in `design-deltas.md`.

## Test plan

- vitest `ui`: each moved site's dom test pins its control to the
  constant (`ACTION_PRIMARY`, `INK_PILL`, `SECONDARY_PILL`, the band
  pill); `HandleForm`'s tone by `carry`; `PhotoRefused` with and without
  Try again; `Page` has no panel width; `form.dom.test.tsx` pins the band
  pill's classes.
- Playwright, existing specs only: `a1-upload` and `a-desk-rail`
  conformance lose A1's rail and assert the one column at 1280 (a layout
  fact happy-dom cannot see). Transcripts re-recorded from the full
  CI-style run. Demo video per skill `pr-demo-video`.

## Issues

- Closes: #621, #622, and #617 if nothing else holds it.
- Opens: none planned. #705 (the capture's holes) stays open on its own.

## Open questions

Guesses I am building on, each sent to the coordinator:

1. A1 at x=330 (233, 168.1) while A2 and A3's column starts at x=168
   (307): the flow's column moves between steps one and two.
2. The photo band's "Pick another", when it is the band's only button,
   takes the ink band pill (167.1: a hairline pill is never alone).
3. The root crash in the 620 column rather than the 390 panel.
4. A2's "Not now" line left-aligned only from 720, not on a phone. A1's
   foot lines ("Wrong file?", "No file?") stay centred: in the one
   column they share an axis, which is what D1-06 asked.
