# Design: sprint-a6 the Call's screen components

> Sprint lane A6 of Epic 200 (#1102), stacked on the integrated engine
> (`sprint-a4`). The coordinator numbers this doc before any PR.

## Problem

The Call's engine answers with a view model (`b2View`) and Round 62 has
ruled its boards, but nothing draws it. This lane builds screen B2 as pure
React components over the view model, in four states: the Call (confident
or probable), a borrowed Call (C1b), no forecast (C0a) and below the
threshold (C0b). No route mounts them yet.

## Approach

A sub-module `src/modules/call/screen/` behind its own `index.ts`. It
imports `call/evidence` and `call/contract` through their doors,
`lib/contracts` and `ui`. No server function, loader, `env` or clock.

Components, in `screen/components/` (so the targets check reads them):

| component        | props                                                                                       | board, ruling                       |
| ---------------- | ------------------------------------------------------------------------------------------- | ----------------------------------- |
| `CallScreen`     | `view: B2View`, `facts: ScreenFacts`, `slots?: { when, sameConditions }`, `verdictsLogged?` | picks the state; one `h1` (A11y 04) |
| `CallHeading`    | `verb`, `chip?: Line`, `when?`                                                              | B2 probable; 363.1                  |
| `BorrowedField`  | `title: Line`, `body: Line`                                                                 | C1b; 363.1, 363.3                   |
| `NoForecastCard` | `when?`                                                                                     | C0a; 366.3                          |
| `KitPieces`      | `pieces: readonly B2Piece[]`                                                                | B2 probable; 364.1, 364.3           |
| `KitParagraph`   | `text?: string`                                                                             | B2; 364.2 (absent, not empty)       |
| `WhyNots`        | `rows: readonly WhyNotRow[]`                                                                | B2 probable; 365                    |
| `CallCount`      | the count `B2Header`, `verdictsLogged?`                                                     | Call Epic C0b; 362                  |

`CallHeading`, `BorrowedField` and `NoForecastCard` live in
`CallScreen.tsx`; `DrawnLine` draws a `Line` and `WhenLine` the hour line.

`sameConditions` is a node the route fills with the feed's block (367);
`feed` is not imported. `when` is the hour line ("TOMORROW · 6:10 AM ·
STEADY"), also a node: it needs a clock and a time zone.

Where a board needs what `B2View` does not hold, a pure function in
`screen/facts.ts` derives it, with Round 62's words in `screen/words.ts`
(each listed in `QUESTIONS.md`, A6, as
belonging in `call/evidence` once the contract settles:

- `drawn(line)`: the shown line without its slot brackets, split at
  " · " so it wraps only there (364.1: brackets are not drawn).
- `screenFacts(result, view, names)`: whether there is a forecast
  (`bandFloorC`), C0a's header `PROBABLE · N RUNS` from `verdictsSoFar`
  (366.3), and the why-nots as question and answer in `uiGroups` order (365;
  the view lists ids best first).
- `verdictsCounted(header)`: the threshold less `remaining`, for 362's
  meter line.

Where the boards and the view model disagree, and what is built:

1. Lines carry brackets; 364.1 draws none. Built: stripped, in `Mono` xs.
2. C0a's header: the view says `[0 RUNS] IN BAND`. Built: 366.3's.
3. Why-nots: ids best first; 365 wants group order and answers. Built: 365.
4. C1b's lines read `[0 RUNS] IN […]` today (A4 Q1, being fixed). Built
   from whatever the view gives; tests assert composition.
5. Below the threshold the view still lists a kit (A4 Q2). Built: the
   count only, as the owner ruled.
6. 362's line needs the runner's verdicts on runs without conditions,
   which no result carries. Built: `verdictsLogged`, a prop.
7. The verb and `BORROWED CALL` have no sentence-case said form.
8. C1b and C0a draw no why-nots; C0a's note says they still show. Built:
   shown wherever the view offers one.
9. C0a's lines say "ALL YOUR RUNS"; the view names each fact's band.
   Built: the view's lines.
10. The hour line and the effort are not in the view. Built: a slot.

Styling: `@theme` classes and `ui` primitives only. Marks are the board's
text marks (`+`, `−`, `▸`), hidden from screen readers; the state is
`aria-expanded`.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**. New bindings/queues/crons: **none**
- Screens implemented: B2, C1b, C0a (no forecast), C0b, as components only
- One `stryker.conf.json` line (`.tsx` under `call`), its own commit

## Test plan

All vitest `ui` (`*.dom.test.tsx`), plus `worker` for the pure functions.
No Playwright: no route, no server hop.

- `test/call/screen/fixtures.ts`: one `CallResult` per state through the
  real `b2View`.
- `facts.test.ts` (worker): `drawn`, `screenFacts`, `verdictsCounted`,
  the words.
- `call-screen.dom.test.tsx`: each state, present and absent parts, the
  heading and names as said.
- `why-nots.dom.test.tsx`: one open at a time, three then "N more".
- `call-count.dom.test.tsx`: the count, the meter line, 362's line.

## Issues

- Closes: none. Opens: none from a cloud lane; questions are in
  `QUESTIONS.md` under A6.

## Open questions

In `QUESTIONS.md`, A6. Guesses proceeded on: the verb is the screen's
`h1`; the feed's slot sits between the paragraph and the why-nots; "N
more" reveals the rest and goes; the count draws its reading and no meter.
