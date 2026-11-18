# Design: 235 hidden-words

## Problem

Wave 14 lane 14b: the Round 59 answers to the 255 sweep's leftovers
(D-187: a name is its visible words, and hidden text may voice a visible
mark, never add words). Four places still hear words nobody sees, and
external links still open a new tab nothing marks. Also #826, the closet
journey's flaky shop-page check, shipped first as its own small PR.

## Approach

- **#779, R59·318, `/open-source` projects** (`OpenSourcePage.tsx`).
  The package name becomes the link (600, underlined, `cold-text` as the
  board draws it), and the right-hand "Project" and its
  `aria-label="Project: <pkg>"` go. A piece with no project URL keeps
  the plain name. The rows sit under a "Projects" heading at
  TYPE.heading in its own case. **Guess:** the board draws one heading
  over two rows with no licence heading around it, but the page's rows
  live inside each licence group, whose heading is already an h2. So each
  group carries its own "Projects" heading as an **h3**, so the outline
  stays licence > Projects. **Guess, #831** (Needs Design).
- **#782, R59·321, the start-time button** (`ParsedCard.tsx`). The time,
  then a visible "Change" (TYPE.small 600, underlined, sans, own case),
  gap 8 inside the same 44 target. The `aria-label` goes, so the name is
  its visible words: "6:04 AM Change". As the board draws it, the time is
  no longer underlined: "Change" carries the affordance. **Guess:** after
  a move the button reads "6:07 AM · Changed Change". The board draws
  only the resting state, and "Changed" is the existing after-state.
  **Guess, #832** (Needs Design).
- **#783, R59·322, no new tab.** `target="_blank"` goes from
  `ProductLink`, `ElsewhereHelp` and `WeatherAttribution` (the only three).
  With no new tab there is no `window.opener` to withhold, so `noopener`
  goes too; `ugc nofollow` and `noreferrer` stay, since they are about the
  link, not the tab. The comments that give the new tab as the reason are
  rewritten.
- **#784, R59·323, non-control text.** AlreadyInCloset's hidden ", works
  at" and GarmentDetail's hidden "… dialed together" go, and the lines
  read whole without them. OwnerAudience's hidden "Seen by: " becomes a
  visible `MONO.xs` "SEEN BY", the first item on the tags' line.
  **Guess:** muted, as the off tags are (the ruling gives no colour).
- **#814, R60·324, link landings and two sign-in bands** (added to the
  lane by the owner). `LinkLanding`'s failure band says "That didn't go
  through." with no Try again of its own: the question's button is the
  retry and takes focus back (`retryRef`). The Google refusal for a
  password account takes NOT CREATED on Au2 (`returnedFailure` knows the
  page by its `admission`), NOT LOGGED IN on Au1 as before. Au1's
  sign-in limit takes NOT LOGGED IN, in the form's slot above Log in,
  where it already sat. Round 60's rule (a refusal a retry can't fix
  drops Try again) is already how all three behave.
- **#826.** The domain check is scoped to the span that holds the link
  (`filter({ has: shopPage })`), so the enrichment line's Site span,
  which shows the same host once enrichment lands, is never a second
  match.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens: /account/verify, Au1, Au2, /open-source (C9), A1 parsed card, F already-in-closet, Z2a
  garment detail's pairs-with, D owner meta. Design deltas: the two
  guesses above, if Design rules otherwise.

## Test plan

- `OpenSourcePage.dom.test.tsx` (ui): the name is the link to the
  project, no "Project" link, the h3 "Projects" per group, a piece with
  no project is plain text.
- `ParsedCard.dom.test.tsx` (ui): the button's accessible name is
  "6:04 AM Change", and after a move "… · Changed Change".
- `ProductLink`, `ElsewhereHelp`, `WeatherAttribution` dom tests: no
  `target` attribute.
- `AlreadyInCloset`, `GarmentDetail`, `OwnerAudience` dom tests: the
  heard text has no added words; "Seen by" is visible.
- e2e: the run-logging specs and walkthrough find the button by its new
  name; the transcripts under `e2e/transcripts/` are re-recorded and
  their diff read (Playwright, because only the browser's own tree says
  what a screen reader hears).

## Issues

- Closes: #779, #782, #783, #784, #814 (and #826 in its own PR).
- Opens: #831, #832 (filed by coordinator-14, Deferred in the PR).

## Open questions

The two guesses above are filed for Design: #831 (318's heading level)
and #832 (321's after-move words). They are listed as Deferred, not
closed. SEEN BY's colour (muted) is a third, smaller guess.
