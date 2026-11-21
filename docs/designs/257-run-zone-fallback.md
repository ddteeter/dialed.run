# Design: 257 a run with no zone reads in its runner's zone

## Problem

A run's day and clock are read in the run's own zone, which comes from its
weather reading (R-96). An indoor run, or one with no reading, has no zone,
and the feed card and the entry detail fall back to UTC. So a Chicago runner's
indoor run at 5:55 PM reads "Yesterday · 11:55 PM" ten minutes later (#925).
The owner's answer, 2026-11-20: use the runner's saved-place zone
(`user_profiles.time_zone`), then UTC.

The profile pages, the public kit and the band runs already do this through
`runDayOf`. Three surfaces do not, all of them in feed:

- the feed card's posted label (`PostCard`);
- the entry detail's run line (`EntryDetail`);
- the entry's report label (`routes/feed/entry.$entryId.tsx`).

## Approach

- **One rule, in `lib/dates.ts`:** `runZoneOf(observed, runnerZone)` returns
  the observed zone, else the runner's, else none (UTC). It is isomorphic,
  so components can use it too. `runDayOf` (`feed/public-web/public-kit.ts`)
  calls it instead of its own `??` chain.
- **The feed card:** the feed's author read (`feed/following/feed.ts`
  `hydrateEntries`) also selects `user_profiles.time_zone`. `FeedItem`
  gains `runnerZone`, and `PostCard` reads its label in
  `runZoneOf(item.conditions?.timeZone, item.runnerZone)`.
- **The entry detail:** the entry read (`feed/entries/entries.ts`) carries
  the author's zone the same way. `EntryDetail` and the route's report
  label use `runZoneOf`.
- **Where the zone comes from:** the run's runner, never the viewer. A run
  happened where its runner is.
- **The spec (#925):** the feed-e1 conformance seeds its runner a place zone
  chosen so that now and the seeded runs share a day: UTC from 06:00 to
  18:00 UTC, and `Etc/GMT-12` otherwise. Either way the runs are at least
  six hours from that zone's midnight. The snapshot is unchanged.

## Contract touches

- Schema changes: **none** (`user_profiles.time_zone` exists, design 142).
- New routes, bindings, queues, crons: **none**.
- Screens: E1's card and the entry detail. A zone-less run's day and clock
  now read in its runner's zone. Nothing changes shape.

## Test plan

- `runZoneOf` (worker, lib): observed first, the runner's next, an invalid
  zone skipped, none when neither is set.
- The feed's hydrate test (worker): an indoor entry's item carries its
  author's zone; an author with none carries none.
- `PostCard` (ui): an indoor run 10 minutes back, across UTC midnight but
  not the runner's, reads `10m ago`.
- The entry read and `EntryDetail`, the same way.
- `e2e/conformance/feed-e1`: the runner's seeded zone, as above.

## Issues

- Closes: #925.
- The D-row is the coordinator's, at the docs pass.

## Open questions

None. The owner answered on #925.
