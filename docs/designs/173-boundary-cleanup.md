# Design: 173 Boundary cleanup (feed→weather seam, R-102, R-96 part 3)

## Problem

Three leftovers. Feed and account read `dialed-weather` tables directly,
although `modules/weather` is the only module allowed to (docs/architecture.md).
Two feed screens, A2 attach and the verdict form, still render `Layout`, not
`BelledLayout`, and DS1b puts the bell on every screen (R-102). Dates that
are not run dates render in UTC with no label, or in the browser's zone,
when they should use the viewer's home-place zone (R-96 (3); owner ruling
2026-11-05).

## Approach

- **Seam.** `modules/weather` gains two cache reads and one delete, exported
  through its index:
  - `observationRowsAt(keys)` returns the cached real observations at the
    given cells, chunked under D1's parameter cap.
  - `freshestObservationAt(lat, lng, buckets)` returns the newest
    observation in those hour buckets.
  - `forgetManualBands(runIds)` is a chunked delete.

  `feed/conditions.ts` keeps its assembly logic (spans, bands, zones) and
  stops importing `schema-weather` and `weatherDb`. In `account/purge.ts`,
  `PurgeDeps.weather: Db` becomes `forgetBands(runIds)`, so the purge
  never touches a weather table. The client-bundle rule is unchanged:
  `conditions.ts` still reaches `env` through weather's barrel, and
  components still value-import only `conditions-shape.ts`.
- **R-102.** `feed/attach.$runId.tsx` and `feed/verdict.$entryId.tsx` load
  `bellStateFn()` beside their data and render `BelledLayout`.
- **R-96 (3).** One zone and one label:
  - **The zone.** onboarding's new `homeTimeZone(db, userId)` returns
    `user_profiles.time_zone` if `isTimeZone` accepts it, and otherwise
    `undefined`. It never falls back to a run's zone, and never reads a
    cookie or the browser. `runnerTimeZone` reuses it.
  - **The label.** `lib/dates.ts` gains `viewerZoneLabel`-style helpers.
    These are the existing formatters plus a `" UTC"` suffix on
    time-of-day labels when the zone is unknown. Day-only labels get no
    suffix (owner ruling, 2026-11-05).
  - **The screens.** These use the viewer's zone:
    - notification times (`NotificationList`);
    - the rate-limit clocks ("send another at"), which drop `deviceTimeZone()`;
    - the data-export expiry;
    - the deletion day, on the sheet and in the email.

    Loaders hand the zone in as a prop.
  - **OtherProfile.** It dates each kit by the run's start, in the run's
    zone, falling back to the profiled runner's zone. This is what the
    public profile already does.
  - Desk and safety screens are out of scope (ruling).

## Shipping

Two PRs:

- **PR A** (`fix/w1-boundary`): the seam and R-102.
- **PR B** (`fix/w1-boundary-tz`, branched from A): R-96 (3).

## R-96 (3): owner answers, 2026-11-05

1. **UTC label.** While the home zone is NULL, time-of-day labels read
   "Mon Sep 2, 14:30 UTC". Day-only labels carry no suffix.
2. **Scope.** Notification times, the rate-limit clocks, the data-export
   expiry and the deletion day move to the home zone. Desk and safety
   screens do not.
3. **OtherProfile.** It shows the run's date in the run's zone, falling
   back to the runner's zone, as the public profile does.

## Contract touches

- Schema: **none** (`user_profiles.time_zone` exists, design 142).
- Routes: no new files. Two feed routes change their layout, and some
  loaders gain a zone.
- Bindings, queues, crons: **none**.
- Screens: A2, verdict (bell); DS3 notifications, account settings, delete
  sheet, other-profile (dates).

## Test plan

- worker `test/weather/read.test.ts`: `observationRowsAt` (empty, chunked
  past 33 cells, exact cells only), `freshestObservationAt`, `forgetManualBands`.
- worker `test/feed/conditions.test.ts`, `run-span.test.ts`: unchanged
  behaviour. They already observe it.
- worker `test/account/purge.test.ts`: the band step goes through
  `forgetBands`, and a failure keeps the claim.
- worker `test/onboarding/time-zone.test.ts`: `homeTimeZone` handles
  NULL, invalid and valid zones, with no run fallback.
- worker `test/lib/dates.test.ts`: the UTC suffix appears only on times
  and only without a zone.
- ui `*.dom.test.tsx`: notification row (zone versus UTC-labelled), OtherProfile run date, rate-limit
  messages, export expiry.
- architecture: a test that no module outside `weather` imports
  `schema-weather`.

## Open questions

- None open. The owner's answers are recorded above.
