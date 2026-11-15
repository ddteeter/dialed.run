# Design: 224 Round 57/58 screen rulings (lane 11d)

## Problem

Round 58 answered 22 screen questions from the styling-audit re-run (#666),
and Round 57 · 255 ruled how controls are named. Each answer is a small
change to one screen: auth, onboarding and settings, closet, feed, legal
and /open-source, and runs. This lane builds them. The shared kinds (#753
hairline secondary, #662 names) belong to 11c, and this lane makes their
call-site edits in its own screens once 11c's API lands.

## Approach

One commit per area, each with the tests that observe it.

- **Auth/settings.** 267: `SignedOutPanel` passes the frame's `intoApp`
  slot through, and Leaving and TermsPrompt fill it with "Signed in" (MONO.xs,
  as the landing's first row). 293: tertiary links sit left under the
  primary at every width, 600 and underlined. 294: the 228 formatter moves
  from `modules/onboarding/place-name.ts` to `lib/place-name.ts`, and the
  candidate card and Your conditions use it. The saved value stays the
  provider's. 295: P2.5's Save is AC2a at every width. 296/297: copy.
  A-06: `FormField` gets a label-row slot, used by Forgot it?. #674: a
  `--text-hero` theme step from `MARKETING.hero`, plus the landing h1.
- **Closet.** 272: below 720 the switch ends the chip row as "Retired (N)",
  named "Show retired". 273: a rangeless tile keeps the slot, empty.
- **Feed.** 283: "What happens next" keeps one sentence. 284: the kit list
  drops its closing rule when YOURS follows. 287: no line under NOT FOUND YET.
- **Legal.** 288: notice text at TYPE.body, lead-ins at their line's size,
  600. 289: two-column tables take the wide table's panel. 291: legal
  lead-ins at their sentence's size, 600. 292: versions in MONO.md, as written.
- **Runs.** 298: R2b's box drops its kicker. 299: `/runs?show=N` (a step of
  50). The loader reads N+1 to know if more exist, plus the total count for
  "Show N more" (the lesser of 50 and what is left). The oldest month listed
  takes its count from a bounded query over that month, on each run's own
  clock. The end line shows only when every run is listed. 300: the status
  sentence becomes sr-only, still the live region. 301: one teal mono line,
  the conditions wrapping whole. 304: at desk the This run card drops its
  credit.

## Contract touches

- Schema changes: **none**. New bindings/queues/crons: **none**.
- Route files: `src/routes/runs/index.tsx` gains a `show` search param.
- `src/ui` (coordinator-11 granted, 2026-11-15, additive only): `SignedOutPanel`/
  `SignedOutLayout` prop, `form.tsx` label-row slot, `CityFinder` name,
  `tokens.css` + `@theme` `--text-hero`.
- Screens: Au2, Keep your account?, Accept the terms, O1, P2.5, Settings,
  closet, W1, D, Your conditions, legal texts, /open-source, R2b, runs
  list, backlog, A2/A3.

## Test plan

- vitest `ui` (dom) per component: the bar's "Signed in", the names and
  copy, the empty range slot, the rule's absence, the sr-only status,
  "Show N more" and the end line.
- vitest `worker`: `listRunSummaries` with a limit, the total count, and
  the cut month's count across a time-zone edge. `lib/place-name` moves
  with its existing tests.
- e2e: the transcripts that change are re-recorded, never hand-merged. No
  new journey.

## Issues

- Closes: #712 #738 #739 #740 #741 #742 #673 #674 #717 #718 #728 #729
  #732 #733 #734 #736 #737 #743 #744 #745 #746 #749. Call sites of #753
  and #662 in these screens follow 11c.
- Opens: whatever is deferred, as issues listed in the PR.

## Open questions

- 299, guess: "Show N more" says the lesser of 50 and what is left, as
  236a counts its real remainder. The ruling's words are "Show 50 more".
- 267, guess: "Signed in" is MONO.xs muted at the bar's right, as the
  landing's signed-in first row.
