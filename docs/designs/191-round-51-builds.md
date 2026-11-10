# Design: 191 Round 51 builds (operator kit view, request access)

## Problem

Round 51 settles two things built on guesses (designs 188 and 187).
**153 (#527):** the operator's kit view gets a run line (date · start time
in the run's zone · temperature · moisture · city), a fixed order, a back
link that names where the operator came from, and a removed state.
**154 (#528):** a blocked region keeps the "sent" redirect, now with copy
that is true in both cases; an over-long note gets its own `note_too_long`
code; and "Have an account? Log in" shows below 720 only.

## Approach

**153.** `deskKitFor` (`modules/safety/desk-kit.ts`) also reads the
run's copy in core (`run_conditions`: the judged feels-like and the precip
class), the runner's city and zone, and the operator's temperature unit,
all in its one batch. The zone of the run's observation comes from
weather's `conditionsForRuns`, as R-96 does elsewhere: the observation's
zone, else the runner's, else UTC. A failed weather read drops only the
zone (law 5). `DeskKit.tsx` renders in the board's order: back link, band,
run line `NOV 4 · 7:12 · 41° · DAMP · BOSTON` (mono, uppercase), photos,
verdict, garments, notes. A removed kit says "Removed. Photos deleted."
where the photos were. The page is read-only.

The back link comes from search params `from` (`report` or `request`) and
`row`, which are parsed by a zod schema in `components/kit-origin.ts` and
validated by the route. "Back to the report" goes to
`/desk/review#report-<row>` and "Back to the request" to
`#request-<row>`; with neither it is "Back to Review". Review's rows and
removal requests get those ids. `OtherPhotos` and `PhotoMatches` take the
origin and pass it on in their kit links, as does "Open the kit".

**154.** `access-endpoint.ts` splits a parse failure: a valid email with
an over-long note answers `/invite?error=note_too_long`, and every other
failure stays `invalid_email`. A blocked region already gets the same
303 to `/invite/sent`, so only its comment changes to cite the ruling.
The sent copy, the `note_too_long` band and the counter from cap − 40 are
drawn by the marketing site (another repo); `docs/design-deltas.md`
records them for it. In `Landing.tsx` the Log in line takes `wide:hidden`.

## Contract touches

- Schema changes needed: **none** (reads `run_conditions`, D-175).
- New route files: none. `desk/kit.$entryId.tsx` gains `validateSearch`.
- New bindings/queues/crons: **none**
- Screens: Desk · Kit (R51·153), Au2 hero (R51·154.3), the M5 endpoint
  (R51·154.1–2).

## Test plan

- `desk-kit.test.ts` (worker): the run line's fields; the observation
  zone over the profile zone over UTC; no `run_conditions` row; a
  deleted run; the operator's °C.
- `DeskKit.dom.test.tsx` (ui): the order, the run line text, the
  removed state, and the three back links with their hrefs.
- `kit-origin.test.ts` (worker): the parse, where junk falls back to none.
- `OtherPhotos`, `PhotoMatches`, `RemovalRequests` and `ReviewQueue` dom
  tests: the kit links carry the origin, and the rows carry their ids.
- `access-endpoint.test.ts` (worker): `note_too_long` vs `invalid_email`.
- `Landing.dom.test.tsx`: the Log in line carries `wide:hidden`.
- e2e: extend `e2e/safety/takedown.journey.spec.ts` (Open the kit → back
  to the request) and its transcript, and `e2e/auth/access-requests.spec.ts`
  for `note_too_long`. Both already cover these paths in a real browser.

## Issues

- Closes: #527, #528.
- Opens: none yet.

## Open questions (marked guesses, sent to coordinator-5)

- **City:** no run stores a place, so the runner's profile city stands in.
- **Temperature:** the judged feels-like in the operator's units, as "41°".
- **No h1 or kit id on the board:** the h1 "Kit" is kept sr-only, and the
  kit id moves below the notes (the takedown form takes it).
- **Removed:** verdict, garments and notes still show.
- **Counter from cap − 40:** M5's only. Au5 keeps round 28's (from 120).
