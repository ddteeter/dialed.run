# Design: 210 The centred column and the Desk's Round 55 builds

## Problem

At width, the runner app left-aligns its 620 column, and some screens (run
detail, edit garment, the Call, notifications) drop to a 390 panel.
Round 54 · 168.1 rules one centred MEASURE.column for every runner screen at
≥720. The Desk still has the audit's shape: a six-row rail that fills a
phone's first screen, no top bar, a plain-list Today, outline Review rows,
and an unbounded used-by list. Round 55 · 194–203 draws each of these.

## Approach

**168.1, the column.** `src/ui/Page.tsx` exports `COLUMN`
(`mx-auto w-full max-w-column`): centred at every width, with no
`wide:mx-0`. Page's `column` width uses it, and `panel` is left only for
signed-out and system screens. Every hand-written runner column swaps its
class for `COLUMN`, and nothing else on the line changes. Those sites are in
feed, closet, runs, notifications and call (coordinator-approved, one line
each). VerdictBacklog (236, 8d), PublicFrame, Landing and SystemState are
not touched. `step` and `close` become centred 620 from `wide`. That is a
**guess**, opened as a Needs Design issue for Round 56.

**194/195, the Desk shell** (`modules/ops/components/DeskShell.tsx`):
- From `wide`: a 56 top bar with [dialed] DESK at the left and
  `@handle · OPERATOR · SIGN OUT` at the right.
- The 200 rail lists seven destinations in the board's order. **Codes is
  its own page**, a new `/desk/codes`, so `/desk/access` keeps Requests.
- The current rail item gets a 2px hi-viz left edge, a `--panel` fill and
  bold text. Hi-viz text is kept for counts.
- The footer is pinned to the rail's foot: `SCREENING · OK|HOLDING` and
  `LAST DIGEST · HH:MM|NOT YET`, worded by the owner on 2026-11-13 (#635).
- Below `wide`: a 48 row with the wordmark and Sign out, then one sticky row
  of destinations that scrolls sideways, with the current one underlined
  and scrolled into view.
- The route passes the operator's handle and `signOut` in as props, since
  `DeskToday` gains `operatorHandle`, `screeningHolding` and
  `lastDigestAt`.

**196, Today** (`Today.tsx`): four `--panel` cards, two by two. Each has a
TYPE.display numeral, a body label and a MONO.xs caption. A numeral is
hi-viz above zero only where a person is needed. The flagged card's caption
reads `NONE FLAGGED` or `OLDEST · 2D` (needs `oldestFlaggedAt`), and the
card links to Runners → Flagged.

**197–199, Review** (safety Desk components, now 8b's). Every row is a
`--panel` card at RADIUS.card, 12 apart:
- The head strip is one button: `KIND · 01M7…BGCG · @owner [SOURCE]` at the
  left, with the age, the clock or the OVERDUE tag at the right.
- A closed row is the strip, a one-line summary and a chevron.
- An open row is a hairline, the body (the photo beside the reasons at
  desk), a hairline, then the bar.
- Their other photos are 96 squares, six across at desk and three across on
  a phone, with shortened ids. They sit just above the bar.
- Removal requests take the same head.
- A copyright hold after court action has two presses: Restore (chalk) and
  Delete (hairline, with its confirm).

**200–203, Codes and Runners.**
- The Codes table has one shared header grid. The used-by cell shows
  `29 USED`, five handle links, then `+ N more`, which opens the code in the
  detail pane.
- Uses read `29 / 1,000,000`, or `29 / NO LIMIT` for a code with no cap.
- Runners' tones follow 201.
- The detail pane keeps the 2fr/1fr track from `desk`. **Below `desk`** it
  opens as 8a's non-modal drawer (`<Sheet isModal={false}>`), and the picked
  row stays marked (202). That waits on 8a's merge.

#644 (Review's kit in a pane) is **not built**: R55·197 contradicts it, and
it is in Needs Design for Round 56. #627 is closed: P3-02 and G-13 are on
main, and N3-13's sentence stays (owner).

## Contract touches

- Schema changes: **none**. New bindings, queues and crons: **none**.
- New route: `src/routes/desk/codes.tsx`.
- Screens: every runner screen's width at ≥720, and D0, D1, D8 and Access.

## Test plan

- vitest `ui`:
  - Page's `column` and `COLUMN` carry no `wide:mx-0`.
  - DeskShell has seven entries in order, and the current one is marked
    with `aria-current`.
  - The footer covers OK, HOLDING and NOT YET.
  - Today's cards: hi-viz only above zero, and both flagged captions.
  - A Review head strip shows the shortened id and the OVERDUE tag, and a
    closed row shows its summary.
  - The used-by cell covers five handles, `+ N more`, `NOT USED YET` and
    `NO LIMIT`.
  - The pane below `desk` renders as a drawer.
- vitest `worker`: the new `DeskToday` fields (operator handle, screening,
  last digest, oldest flagged).
- e2e: extend the Desk journeys for `/desk/codes`, and record new conformance
  transcripts. Playwright is used only because the phone rail's sticky
  scroll-into-view needs a real layout.

## Issues

- Closes: #635 and #627. Refs #622: 8b does 168.1 and 202's drawer, and
  168.2 is 8d's, so whichever PR lands last closes it.
- Opens: #654, the onboarding steps' width at ≥720 (Needs Design).

## Open questions

- `step`/`close` at 620 centred from 720 is a guess (#654, Round 56).
