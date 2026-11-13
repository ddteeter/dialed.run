# Design: 202 round 52 builds

## Problem

Round 52 ruled six accessibility items the transcripts for #582 found.
Each changes what a screen reader is given and nothing that is drawn.

## Approach

Two PRs. The rulings are the latest comment on each issue.

**PR 1: names and roles.**

- **#589 (R52·157).** On a search row the Follow pill's name carries the
  handle, visually hidden, in all four states. `FollowPill` takes the
  handle as a prop; `RunnerSearch` passes it and H's header does not.
- **#592 (R52·159).** A2's second button is named "Change the kit"; the
  visible word stays "Change" (`AttachKit.tsx`).
- **#593 (R52·160).** The Delete account row is one button named "Delete
  account", described by its sentence, with the right-edge "Delete"
  `aria-hidden` (`DeleteAccount.tsx`).
- **#594 (R52·161).** The log-flow launcher drops `aria-haspopup` in
  `TabBar.tsx` and `TopBar.tsx`. The controls that open real dialogs keep
  it. Every phone transcript's tab bar line changes, and the VoiceOver
  script's step 2.1.

**PR 2: measured lines.** #591 (R52·158) with #567 (R52·155), since the
Desk's run line is in both.

- **One function**, `measuredLine` in `lib/contracts/measures.ts`. A
  line is groups joined " · ", a group is parts joined by a space, and a
  part is typed: a temperature (optionally "feels", optionally with its
  °F/°C letter), a temperature range, humidity, wind, a distance, a
  duration, or a word already in words (a sky, a condition, a day, a
  time). It returns the drawn line, character for character, and the
  said form: full words, a comma between parts, units spelled out, in the
  viewer's units, through the converters the drawn number uses.
  `ui/Spoken` renders them, the drawn half `aria-hidden`.
- **In, named by Design:** A1's conditions (`ConditionsBlock`, also run
  detail's), the kit card's conditions (`ConditionsCell`: the feed's
  card, D's strip and G's list), the receipt (A3's "This run" card), the
  Desk's run line (`DeskKit`).
- **In, the same kind:** the verdict backlog's conditions and its time and
  distance; A2's header and rail; A1's start-time "was" text and facts
  line; the runs list's reading; A1's headline (the provider's "36°F" and
  its class); the feed card's and D's distance; G's recent entries;
  `/kit`'s and the public profile's "38° damp". A temperature with its
  °F/°C letter is an abbreviated measure.
- **Round 53 · 162.3 (asked back as #605):** a temperature range always
  takes the spoken form. In: Your conditions' "Same conditions · Feels
  [41–46°] · damp" and the band history card's heading ("Last 2 in 32–41°
  damp"), whose `RailCard` title now takes a node. The kit picker's group
  counts and the band history's rows were listed by 162.3, but each shows
  one temperature, not the band, so the single-temperature rule applies.
- **Out:** a bare single temperature with a sky word ("41° damp"): a
  screen reader already says it in words (162.3).
- **The other ranges** 162.3 reaches (the closet, A3's history line and
  Noted sentence, KitRecord, the set-band screens, the Call ladder, G's
  band word) are #613, the next PR from this lane. Pace and duration where they were already
  `Spoken`. A3's headline "6.2 at 41°", whose unit is already said. Now
  go run's sentences. The OG images, which are not a screen. `/kit`'s
  stats grid, whose distance unit is a term under its number.
- **#567:** the city and the profile-city read go; the h1 reads "Kit by
  @handle"; the id is MONO.xs `--muted`, selectable; back from a kit the
  row named in the link's anchor takes focus (`useReturnToRow`), and in
  Review it is the row that opens.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens: none redrawn. The Accessibility Contract's new rows are the
  coordinator's import.

## Test plan

- dom: the pill's name with and without a handle, at rest and in flight
  (`feed-profiles.dom.test.tsx`); "Change the kit"
  (`attach-kit.dom.test.tsx`); the Delete row's name and description
  (the account settings' dom test); the launcher without the attribute
  (`top-bar`, `layout`, `motion-surfaces`, `ui.test.tsx`).
- e2e: no new test. The transcripts that end on these controls change,
  and are named in the PR.

## Issues

- Closes: #589, #592, #593, #594 (PR 1); #591, #567 (PR 2); #613 (PR 3).

## Open questions

- R52·157 writes the in-flight names with an ellipsis ("Following
  @handle…") and its example ends "button, pressed". The pill has neither
  today, on H or on a row: in flight its brackets are hidden and
  `aria-busy` says it is working, and the followed state is its name,
  with no `aria-pressed`. Built as "Following @handle", busy, and not
  pressed. Sent to the coordinator: whether the mark and the pressed
  state are wanted, which would change H's pill too.
- R52·160's row is built as a button laid over the row, holding no text.
  With the sentence inside the button its visible text was more than its
  name, which axe reports (WCAG 2.5.3, label-content-name-mismatch). It
  is heard as ruled and drawn as before.
