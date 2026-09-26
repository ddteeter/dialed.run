# Task 129 — Feed

Lane 5 of 5 building to the launch development plan. Read
`125-129-launch-development.md` first: it holds the rules every lane
shares, the migration protocol and the cross-lane seams.

**Starts after PR #102 merges.** #102 rebuilds the feed and social screens
and leaves three follow-ups this lane picks up (the bell, the city writer,
O1's resolver). This is the smallest lane; it also applies the other lanes'
visibility rules to the surfaces it owns.

## You own

- `src/modules/feed/**` and `src/routes/feed/**`, **except**: 127's files
  (`AttachKit`, `VerdictForm`, `VerdictChips`, `SpecificsSheet`,
  `NotedReceipt`, `BandHistory`, `chips.ts`, `band-signals.ts`,
  `attach.$runId.tsx`, `verdict.$entryId.tsx`) and 128's (`photos.ts`,
  `photo.$.tsx`, `retract.ts` and its components). `entries.ts` and
  `functions.ts` are shared: additions only.
- `src/modules/notifications/**`, `src/routes/notifications/**`
- `src/modules/onboarding/profile.ts`, and the calibration and place files
  O1's resolver touches (`functions.ts` there is shared with 126: additions
  only)
- `e2e/feed/`, `e2e/conformance/feed-*`, `e2e/conformance/notifications-*`,
  `test/feed/**` (except 128's photo tests), `test/notifications/**`

## Work

**FEED-1 · Noindex by default [F]** (§6). Public profiles (H) and entries
(D) carry `<meta name="robots" content="noindex">` through their route
heads, matching 125's `robots.txt`. Whether runners' names and photos
belong in search engines is an owner decision not yet made; noindex is the
default until it is. Test: both routes' heads carry it.

**FEED-2 · O1 → `resolvePlace` [F]** (#104's "Needs" item 1). **Check first**:
if #104 or #102 already set `O1_PLACE_RESOLVER = resolvePlace`, this item
is done — say so in the PR. Otherwise it is one line plus the test that a
typed city on O1 saves coordinates.

**FEED-3 · The bell counts runs awaiting a verdict [P]** (#102's
follow-up). Point `bellState` and `markAllNotificationsRead` at
`runsAwaitingVerdict` (`modules/runs` index), and drop the 14-day window
(`VERDICT_WAIT_WINDOW_S`). One definition of "awaiting", owned by runs.
Test: a run from 30 days ago with no verdict counts.

**FEED-4 · The following feed past 92 follows [P]** (D-101). Replace the
bound followee list with a subquery on `follows`, so the statement binds
one value however many people a runner follows. **Attach `EXPLAIN QUERY
PLAN` before and after** to the PR, showing the covering indexes still
carry it. Test: a viewer following 150 runners gets a page, correctly
ordered and paged by cursor.

**FEED-5 · One writer for the profile city [P]** (#102's follow-up).
`user_profiles` city/lat/lng has two writers: onboarding's `saveCalibration`
and Your conditions' typed-city save in `feed/home.ts`. Make it one,
exported through `modules/onboarding/index.ts`, and have Your conditions
call it. Test: both paths write the same three columns together, or none.

**FEED-6 · D-62, the feed half [P].** The author sees "under review" on
their own hidden entry, on the card and on D, from 128's predicate
(SAF-9). Nobody else sees the entry at all, as today. Design ask for the
marker.

**FEED-7 · Banned and deleting authors leave search and profiles [P]** (0.3,
§2.1). Apply the one visibility rule (seam 6) to runner search and H.
Build against the predicate's signature as 128 and 126 publish it in their
design docs.

**FEED-8 · Visual Crossing attribution everywhere conditions show [P]**
(§1.8). The licence requires "Weather Data Provided by Visual Crossing"
with a link near the data, on every surface that shows conditions. The
audit saw `ui/WeatherAttribution` in two places. Check EntryDetail, the feed
card's strip, Your conditions and the profile surfaces; add it where
missing. Test: each surface renders it.

**FEED-9 · Round 25 on Your conditions [P]** (`Round 25 Rulings.dc.html`).
The eyebrow `SAME CONDITIONS · FEELS [{lo}–{hi}°] · {PRECIP} · {WINDOW}`; the
line "In {feels}° and {precip}, {window}, wherever they were."; wind leaves
the eyebrow; no line names a place. E1's compact line and N's privacy card
follow. Conformance spec against the board.

## Tests

Worker tests for FEED-2 to FEED-5 and FEED-7; ui tests for FEED-6 and
FEED-8; conformance for FEED-9. Mutation stays at 100% on `modules/feed`,
`modules/notifications` and every `.tsx` you touch.

## Demos

`e2e/feed/`: Your conditions in the new wording; the bell counting an old
run; the author's under-review marker.
