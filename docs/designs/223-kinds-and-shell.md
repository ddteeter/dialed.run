# Design: 223 shared kinds and shell (wave 11, lane 11c)

## Problem

Rounds 57 and 58 settled the app's button kinds and its desk edge. The
shared pieces in `src/ui` and the shell still draw the old answers: the
bar's content sits 24 left of every page's at desk, a few controls name
words nobody sees, and a handful of buttons use kinds the rulings
withdrew. This lane changes the shared kinds and the shell. 11b (Desk)
and 11d (the screens) change their own call sites against them.

## Approach

**The kinds keep their names** (`src/ui/form.tsx`). Round 58's three are
already exported: the primary (`ACTION_PRIMARY`, `tone="action"`), the ink
pill (`INK_PILL`, `tone="ink"`) and the hairline pill (`SECONDARY_PILL`,
`tone="secondary"`). The one addition is `data-ground="paper"` in
`tokens.css`, which mirrors `night`: a block that is paper in both themes.
The hi-viz card takes it, so its ink pill stays ink in dark (#750).

- **#708, one desk edge.** The gutter moves inside the bar's `max-w-page`
  (TopBar, SignedOutFrame's bar and footer), so the bar's content is 1,132
  at x=74 at 1280, the same as every page. Below 1,228 the edge is the 24
  gutter. `Page`'s column drops its inner 24 from `wide`, so a 620 column
  holds 620 of content at x=330. The screens that draw their own `COLUMN`
  (feed, garment detail) make the same change in 11d.
- **#662, names hold only the visible words.** Both wordmarks are named
  "dialed.run". A notification's sr-only "Unread" stays, because it voices
  the dot. The sweep list of every other site goes to 11b and 11d.
- **#751.** SheetReceipt's Done becomes `INK_PILL`.
- **#753.** CityFinder's ink-edged Find takes the hairline pill's edge at
  the field's own height.
- **#711.** The signed-out panel is a fill context, like the drawer. Its
  primary spans the 342 at ≥720.
- **#757.** The bell's count badge anchors at the glyph's top-right with a
  2px `--ground` ring.
- **#731.** NOTIFICATIONS becomes "Notifications" in TYPE.title.
- **#752** moved to 11d (coordinator, 2026-11-15). My guess went with it:
  `DeskSplit`'s 620 + 24 + 300 group, centred in MEASURE.page, with the 300
  marked as a guess pending Design 316 (#771).
- **#662's open three.** PasswordField's "Show password", the tab bar's
  "Add a run" and the compact weather credit predate 255's rule. Each
  needs an answer on whether 255 overrides it, so all three stay as built
  until one comes.

Call sites in 11d's files: Resend link and Not now (#715), A2b/A3b Done
(#747), That's it (#750), A1's Open that run and the delete-with-runs pair
(#751), and the ink-edged secondaries (#753).

## Contract touches

- Schema changes: **none**. Bindings, queues, crons: **none**. Routes: none.
- Screens: the top bar, the signed-out frame, every `Page` column, sheet
  receipts, the signed-out auth panel, the phone bell, N (notifications).

## Test plan

- `test/ui/contrast.dom.test.tsx` (ui): the paper block applies `ground-paper`.
- `test/ui/top-bar` and signed-out frame dom tests (ui): the wordmark is
  named "dialed.run"; the gutter is inside `max-w-page`.
- Page, SheetReceipt, SignedOutPanel, NotificationBell, NotificationList
  dom tests (ui): each kind and class carries the rule it states.
- Transcripts: the wordmark rename changes every signed-in and signed-out
  transcript, which I regenerate and review with `a11y-judgment`. No new
  spec, because nothing here crosses the server.

## Issues

- Closes: #711 and #757 here. #708, #662, #731, #751, #753, #747, #750
  and #715 close when 11d's (and for #662, 11b's) call sites land; the PR
  lists mine and theirs per item.
- Opens: whatever the sweep finds that nobody owns.

## Open questions

- **Guess:** the Desk's round-44 `QUIET_PILL` keeps its ink edge, because
  D-186 makes the kinds per surface. It is open for round 59 as Design 317
  (#778).
