# Design: 251 /how-it-works

## Problem

Settings › Privacy's "How the guides are made" link should land on
`/how-it-works#totals`. The page doesn't exist yet, so the link opens the
privacy policy instead (design-deltas open queue item 61). The owner approved
the copy on 2026-11-12 (#523: draft 2 plus two edits), and Round 53 · 163
drew it (#611). This lane builds it before the friends freeze (#850).

## Approach

- **Copy:** word for word as approved, with one change. On 2026-11-19 the
  owner reworded the Garmin answer, because runners can't connect Garmin yet
  (#441): "Not yet. Connecting Garmin is coming. Until then, export the run
  from Garmin Connect and upload the file." (#523, comment 7010957059.) The
  copy re-check against main found no other drift.
- **Layout:** M4's legal layout is already built as `ReadingFrame` /
  `ReadingSection` (240 sticky contents, 620 measure, "Back to contents"
  below the desk). The page is a new `HowItWorksPage` composed from them:
  - 163a: the loop is an `<ol>` with MONO `01`–`04` in a 56 column (36 below
    1040), each bold lead running into its sentence, hairlines between the
    steps, and "Coming next" as a `--panel` inset.
  - 163b: the guides are a `<dl>`, its terms in MONO.xs capitals in a 160
    column on desk and stacked on the phone. The section's id is `totals`.
  - 163c: each question is an h3 with its answer always shown. The Strava
    API agreement and privacy policy links are underlined ink.
  - 163d: the page closes with a 52 pink Request access pill, full width
    below 1040, with "Have an account? Log in" under it below 720. The top
    bar is `SignedOutFrame`'s, unchanged.
  - 163e: no verdict-scale component.
- **Where the page lives:** the coordinator places it, because
  `ReadingFrame` moves into `account/terms` (doc 240) in lane 16b. See the
  open questions.
- **Route:** `src/routes/how-it-works.tsx`, which is public. A signed-in
  reader gets the signed-in shell, as `/privacy` does.
- **TotalsSwitch** links to `/how-it-works` with `hash: "totals"`.
- **Wordmark:** `[dialed.run]` inline in the prose, in the bracket notation.

## Contract touches

- Schema changes needed: **none**
- New route files: `src/routes/how-it-works.tsx`
- New bindings/queues/crons: **none**
- Screens: M4 (Round 53 · 163a–e). Design-deltas queue item 61 is closed by
  the TotalsSwitch link.

## Test plan

- `how-it-works.dom.test.tsx` (ui):
  - the five h2s, in the board's order, each with an id;
  - the contents list links to each id;
  - the loop has four `<li>`s, each with its 01–04 number and its lead;
  - the guides `<dl>` sits under `#totals` and has four term/definition
    pairs;
  - there are four h3 questions, including the reworded Garmin answer;
  - the Strava and privacy-policy links have the right hrefs;
  - Request access goes to `/account/request-access`.
- `totals.dom.test.tsx`: the existing test is updated so the link's href is
  `/how-it-works#totals`.
- e2e: the a11y transcript for the new public page, as the other reading
  pages have one.

## Issues

- Closes: #523, #611.
- Opens: a watch item to rewrite the Garmin answer from the privacy
  policy's Garmin section once #441 ships.

## Open questions

1. **Where the component lives.** I recommend
   `account/terms/components/HowItWorksPage.tsx`, built on top of 16b's move.
   This is waiting on the coordinator.
2. **FAQPage JSON-LD.** 163c names rich results as the reason the answers
   are always shown. My guess is to emit a JSON-LD `<script>` in the route's
   `head`, built from the same question array the page renders. The
   reviewer can veto it.
