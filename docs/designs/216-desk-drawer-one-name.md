# Design: 216 the desk drawer says the picked name once (#663)

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

**Guess, sent to the coordinator:** the drawer's title then shows a code in
the Sheet's display type, not mono. If Design wants the code in mono there,
that is a `Sheet` title change for 9a, not this lane.

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
- Transcripts: any e2e transcript that opens the drawer is regenerated, and
  its diff should only lose the repeated name.

## Issues

- Closes: #663
- Opens: none expected

## Open questions

- Code in display type in the drawer title (above). Proceeding on it.
