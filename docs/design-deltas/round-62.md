## Answered in round 62 (imported 2026-11-26)

Design answered as `Round 62 Rulings.dc.html`, items 340–367, every one
in the table on the board, with ten boards drawn above it. The board's
text is the text of record; each ruling is also a comment on its issue.
Design took the three notices as read: the Call's engine (the Call's
boards are redrawn to it: every line a counted fact, no kicker words, no
BEST GUESS, no receipt or promise), times with no place (#1110: " UTC"
shows only when no zone resolves, and nothing is redrawn) and How you run
(#1134). Five rulings confirm what is built, so #868 (341), #894 (345),
#895 (346), #952 (358) and #1037 (359) are closed. Every other item's
issue is Ready with its ruling. `design/tokens.js` gains 360's line in
`SPACE_RULES`.

**Runs: A1, A2, A3, DS2, R**

- **340.1 · changed.** At desk, A1 joins A2 and A3's group: its column
  starts at x=168 with an empty MEASURE.aside track to its right, so A1 to
  A2 doesn't jump. Supersedes R55·233's centring at desk; below desk is
  unchanged.
- **340.2 · changed.** From 720, A1's two foot lines go left under the
  hugging action, as A2's do (R58·293). On a phone all three stay centred
  under the full-width action.
- **351 · ruled.** While A2 waits for the run's weather: "Suggestion comes
  with the weather · usually under a minute." It swaps in place when the
  weather lands, with no reload and no shift of the rows below. "No
  weather on this run, so no suggestion." shows only once the fetch has
  given up.
- **352 · ruled.** Warm and cold flag chips land only on the layers that
  set warmth: tops, bottoms, outer, hands_head. Shoes and socks_extras
  never carry one.
- **353.1 · drawn.** DS2's picked row takes the Accessibility Contract's
  focus ring (2px in the text colour, inset) over `--tint`, with the date
  at 600. It reads in both themes.
- **353.2 · drawn.** A3's rail is a ruled list: TYPE.small, a hairline
  between names, names wrapping at whole words, never truncated. A2's
  band card follows (the shared component).
- **354 · drawn.** R with no place: "No place on this run, so no weather
  came." Two ways out: "Set conditions ›" (R2b without coordinates; typed
  weather, stored as manual) and "Add where you run" (U1's How you run
  row).

**Feed: E1**

- **355 · drawn.** No follows, own posts: a ruled row above the runner's
  posts, "You don't follow anyone yet." with the `SECONDARY_PILL` "Find a
  runner", until the first follow. The full E1v1 block stays for an empty
  tab.

**Safety: W1**

- **356 · drawn.** §AF wins. After a report that is not an intimate image,
  the Report control says "Report sent" in its place for the fixed hold,
  then reads "Reported" as plain text. It is not offered again to that
  runner for that entry. Supersedes Round 42 #85's toast.

**Closet: the garment form**

- **341 · confirmed.** A lone "Pick another" is the ink pill: it is the
  band's one way on, not a close. R54·167.1 holds.

**Auth: Au5, request access**

- **357 · changed.** Au4's frame as built. The semicolon splits: "Open it
  to hold your place on the list. It lasts 48 hours."
- **358 · confirmed.** The confirm page's ask, receipt (the
  blocked-region variant included) and unmatched state, as built.

**Desk: Review**

- **348 · changed.** The claimed handle reads MONO.xs REQUESTER SAYS, then
  the handle as typed in TYPE.small, not a link, then MONO.xs NOT CHECKED.
  A link would read as resolved.
- **350 · changed.** The kit link and `[n people] · reasons` are
  confirmed. Each reporter's note sits under that reporter's line after
  MONO.xs THEIR NOTE, in TYPE.small, SPACE[1] between, so it can't read as
  the Desk's words.
- **359 · confirmed.** The Blocked section's row, words and ask as built,
  under the removal requests. The row's "Unblock" is `SECONDARY_PILL` and
  the ask's "Unblock" the ink pill. The answered row stays until reload.
- **349 · ruled.** The busy-hour email's body: "Removal requests are
  coming in faster than usual: {count} in the last hour. Past {hideLimit},
  new requests stop hiding anything. Past {emailLimit}, we stop emailing
  you about each one. Every request still waits in Review with its 48
  hours." Then the Review link.

**Shell: every screen**

- **342 · changed.** The root crash is MEASURE.panel, centred, as the
  signed-out pages are: it has no bars and replaces no screen. R55·185
  still governs every other system state.
- **344 · drawn.** Email not arriving: the shell's notice band under the
  bar on signed-in screens, and the same line on Settings › Email; not the
  bell. It names the address. "Change address", "Send a test" and "Not
  now" (hides the band for 7 days; the Settings line stays). It goes when
  a send is delivered or a new address is confirmed. Signed out, Au4 adds
  "Our last email to this address didn't arrive." above Resend.
- **360 · changed.** The phone gutter is SPACE[5] for every Page screen.
  The closet's 16 stays the one exception, recorded in `SPACE_RULES`.
- **361.1 · changed.** Duplicates takes 197's card (RADIUS.card).
  Supersedes D2's square.
- **361.2 · ruled.** Account's children go back to "‹ Account".
- **361.3 · ruled.** X1 never marks a tab: a not-found page marks none.
- **361.4 · ruled.** `/@handle` shows INDOOR, as G, H and D do.
- **361.5 · drawn.** A verdict has two looks, by role. In a row or card
  (E1, D, `/@handle`, `/kit`) it is the T2 chip. As the headline (G, H) it
  is the T2 word at TYPE.display. The outlined pill goes.

**Every screen: pill kinds**

- **343 · ruled.** The bar's pill counts toward R61·334.1's one
  `ACTION_PILL`. An in-page pill is `ACTION_PILL` only when the bar shows
  none; otherwise it is the ink pill. So the own profile's "Log a run",
  the invite card from 720 and `/how-it-works`' close from 720 (and signed
  in) are the ink pill; below 720 they stay pink.
- **345 · changed.** `ICON_BUTTON` as built, everywhere: the page's ground
  fill with the hairline edge. One state, not two. Supersedes R61·334.4's
  "no fill".
- **346.1 · confirmed.** List rows keep R55·217. R61·334.3 is the profile
  header only.
- **346.2 · ruled.** Follow is 48 in the header (HEIGHT.control) and 44 on
  rows.
- **346.3 · confirmed.** The held width is the widest label, in-flight
  verbs included.
- **347.1 · ruled.** A pill in a bar is 44 whatever its kind, in
  TYPE.body. "Open in the app" is the ink pill at 44.
- **347.2 · confirmed.** A picked suggestion chip means the field holds
  its words. "Name it" never shows picked; unpicked words are ink.
- **347.3 · changed.** `ACTION_PILL` always hugs. The three that fill now
  hug.
- **347.4 · confirmed.** `/open-source`'s contents column, its ids and
  "Read the MIT licence" keep the short names.
- **347.5 · changed.** The 102 was the board's arithmetic. The spaces are
  the ruling; the runs row is a min-height that follows its type (about
  106). Supersedes R61·336's 102.

**The Call tab: K**

- **362 · ruled.** The meter reads "0 of 15 verdicts counted" in every
  state. With verdicts but none counted: "Verdicts count on runs with
  conditions. Yours so far have none." C0b carries it.

**The Call: B1, B2, C0a, C0b, C1b, O5**

- **363.1 · drawn.** PROBABLE takes CONFIDENT's slot and treatment, ink on
  paper, introduced by PROBABLY WEAR. Only BORROWED is hi-viz on ink.
- **363.2 · ruled.** O5 leaves the epic, and its source bars with it. No
  one-time framing: the first Call shows the header it has.
- **363.3 · drawn.** C1b is a borrowed Call at home: no place, no
  altitude or UV, no paragraph, and the source reads "runners in your
  climate" or "other runners".
- **363.4 · ruled.** Both "Log a verdict after…" lines go.
- **364.1 · drawn.** The six line forms are confirmed. The brackets are
  the engine's slots and are not drawn. At 390 the line sits under the
  piece's name, in MONO.xs, wrapping at its " · ".
- **364.2 · confirmed.** The paragraph is one or two of the engine's
  sentences. With none, the hi-viz field is absent.
- **364.3 · confirmed.** NO VERDICTS YET reads right; C2a's use agrees.
- **365 · drawn.** Why-nots sit under the paragraph: MONO.xs WHY NOT, then
  up to three disclosure rows in group order, 44 each, one open at a time,
  the answer in TYPE.small. The rest wait behind "▸ N more".
- **366.1 · ruled.** Distance leaves B1 and C0's header. The stepper goes;
  effort is the segment.
- **366.2 · changed.** B1's effort sentence: "Harder runs dress lighter: a
  workout reads about 9° warmer." It is the table's figure, said of runs,
  not of the runner.
- **366.3 · drawn.** C0a with no forecast: a card, NO FORECAST FOR THIS
  HOUR, "This Call comes from all your runs, not this hour's weather." The
  header is PROBABLE · [N RUNS], with no "IN BAND", and there is no
  paragraph.

**The Call: B2's same conditions**

- **367.1 · ruled.** The block is the feed's Same conditions as built
  (everyone's shared runs). There is no follows-only read.
- **367.2 · ruled.** Its title is "RUNNERS IN THESE CONDITIONS". Under 5
  runners the block is absent.
- **367.3 · changed.** The sentence goes: "long-sleeve" has no source. The
  block's one line is the feed's dialed count, in MONO.sm.

Read against the code at the import: the board's examples are in °F, so
366.2's "about 9°" is the effort table's workout step, and a runner
reading °C needs the same step said in °C.
