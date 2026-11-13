# Design: 209 Wave 8 primitives: controls, buttons, the desk drawer

## Problem

The styling audit traced dozens of findings to four shared primitives. The
browser's blue checkboxes and radios, with no chosen-row state (166). Four
primary-button shapes, and full-width buttons at desk (167). A desk sheet
that blanks the page, top bar included, and has no edge (164.1, 164.2,
164.4). Sheet headings set at three different sizes (173). Round 54 and
Round 55 ruled on all of them. This lane builds the primitives first, so the
area lanes adopt them.

## Approach

- **`src/ui/form.tsx` controls (166).** `ToggleField` draws a 20 checkbox:
  RADIUS.tight, a 2px ink edge, an ink fill with a `--ground` tick, inside a
  44 target that covers the label. With `isSwitch` it draws the 48×28 switch
  at the row's right: a pink track when on, an ink knob, and the label at
  TYPE.body 600. Every `ChoiceList` in rows layout becomes one card with
  hairline dividers. Each radio is a 20 ring with a 10 dot, and the chosen
  row takes a 2px inset ink edge. Labels are 400. All controls take the same
  focus ring: a 2px `--ground` gap, then 2px pink. The CSS lives in a
  `@utility` in `tokens.css`, keyed on `:checked`, so the native input
  stays and keyboard and form behaviour do not change.
- **Buttons (167).** `SUBMIT_TONE` gains the account ink pill at 48 and a
  secondary hairline pill. At ≥720 every tone hugs its label (`wide:` SPACE 6
  a side, 200 minimum, left-aligned). Inside a drawer it stays full width.
  The pink caps `action` tone keeps RADIUS.card, the one exception to "always
  pill". Screen call sites that change tone (forgot, reset, unsubscribe,
  takedown, request access, settings Save, P3) are the area lanes'. I fix
  only the call sites my API changes break.
- **`Sheet.tsx` (164, 173).** The sheet renders its own header: `label` as
  an h2 at TYPE.title, and the ✕ in its own 44 column. Every caller drops
  its own h2. This is a mechanical change across 13 callers, and it moves
  8d's SetConditionsSheet title too. At ≥720 it is the drawer: 390 wide,
  24 under the bar and 24 from the right, `--panel` (white in light), a
  hairline all round, RADIUS.sheet and one lift. The backdrop is
  transparent, so the page stays visible and `showModal` keeps it inert. An
  optional `footer` slot pins the footer. The body scrolls between the two
  pinned parts, and the header gains its hairline once the body scrolls.
  This applies at desk, and on phone once the sheet passes 90% of the
  viewport's height. `isModal={false}` is for 8b's Desk pane below desk: it
  calls `show()` instead of `showModal()`, and the ✕ and Esc still close it.
- **ConfirmSheet (164.2).** Ink pill Delete and hairline Keep it, both full
  width. Focus returns to the trigger.
- **ReportSheet (W1).** The reasons move into the one-card ChoiceList. The
  footer holds the one-line consequence, Send report, and "Send and block"
  as a hairline pill with its consequence line. Its accessible name is
  "Send report and block {handle}" (166.6). The tick box goes.
- **Fields (R55 179, 180, 227).** `FieldShell` fills with `--panel` in both
  themes. The rest edge is `--hairline` in light and `--hairline-2` in dark.
  Focus and error are a 2px inset ink edge, and the fill never changes. The
  error summary sits at an 8 rhythm, and each row's 44 target grows by
  padding against a negative margin. A `ChoiceList`/`FieldGroup` prop
  `legendStep="question"` sets the legend at TYPE.heading. 8c passes it from
  CalibrateForm.
- **AF1 (#645).** A `label-swap` utility in `motion.css`: opacity over
  `--dur-instant` with `--ease-snap`. `CopyLinkPill` uses it.

## Contract touches

- Schema changes: **none**. New routes: **none**. New bindings: **none**.
- Screens: every sheet; O1, U2 Privacy, closet F, R1, W1, A3 audience, AF1,
  takedown, notifications.
- `design/tokens.js` RADIUS_RULES (167.3) lands with coordinator-8's Round 54
  import, not here.

## Test plan

- `test/ui/form.dom.test.tsx` (ui): the checkbox, switch and radio classes;
  the chosen row's edge; the one card; the tone and width classes per tone.
  The pill pin at :697 now carries the RADIUS.card exception.
- `test/ui/sheet.dom.test.tsx` (ui): the header heading and ✕; the drawer
  classes; the transparent backdrop; the footer pinned; the header's
  hairline after a scroll; `isModal={false}` uses `show()` and Esc closes it.
- ReportSheet and ConfirmSheet dom tests: "Send and block" names the handle
  and sends `alsoBlock`; focus goes back to the trigger.
- `motion-tokens-only` / `motion-surfaces`: the new utility uses tokens only.
- e2e: no new spec. The existing journeys and conformance cover the sheets.
  I update the selectors that read the old h2 or the tick box.

## Issues

- Part of #633/#638 (179, 180, 227), no Closes.
- Closes: #620 (the shared set; screen moves outside these files are noted
  on the issue), #643, #645. #618: 164.1, 164.2 and 164.4 only (164.3 is
  8d's), so it is not closed. #621: the primitives only; it stays open for
  the area lanes' tone moves.
- Opens: whatever the build finds.

## Open questions

- **Guess:** the drawer's "one soft lift" has no token. I take the board's
  `0 8px 28px` at 10% `--scrim` as a `--lift` token in tokens.css. This has
  been sent to coordinator-8 for Design.
- **Guess:** "--card in light" is `--panel` (`#ffffff`, the Strava card's
  white). No `--card` token exists.
