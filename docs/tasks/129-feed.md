# Task 129 — Feed

Lane 5 of 5 building to the launch development plan. Read
`125-129-launch-development.md` first: it holds the rules every lane
shares, the migration protocol and the cross-lane seams.

**Starts after PR #102 merges.** #102 rebuilds the feed and social screens
and leaves three follow-ups this lane picks up (the bell, the city writer,
O1's resolver). It also applies the other lanes' visibility rules to the
surfaces it owns, and builds round 26's feed items (#7 placements, #9, #11
band, #12 city, #18 G, #22 entry meta).

## You own

- `src/modules/feed/**` and `src/routes/feed/**`, **except**: 127's files
  (`AttachKit`, `VerdictForm`, `VerdictChips`, `SpecificsSheet`,
  `NotedReceipt`, `BandHistory`, `chips.ts`, `band-signals.ts`,
  `attach.$runId.tsx`, `verdict.$entryId.tsx`) and 128's (`photos.ts`,
  `photo.$.tsx`, `retract.ts` and its components). `entries.ts` and
  `functions.ts` are shared: additions only.
- `src/modules/notifications/**`, `src/routes/notifications/**`
- `src/modules/onboarding/profile.ts`, and the calibration and place files
  O1's resolver and city step touch (FEED-12) (`functions.ts` there is shared with 126: additions
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
The bell's accessible names are "Notifications" and "Notifications, 3 new"
(round 26 #9).
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
and O1 call it. Round coordinates with 127's helper (STR-14, D-110) before
storing. Test: both paths write the same three columns together, or none.

**FEED-6 · D-62, the feed half [P].** The author sees "under review" on
their own hidden entry, on the card and on D, from 128's predicate
(SAF-9). Nobody else sees the entry at all, as today. Design ask for the
marker.

**FEED-7 · Hidden authors leave search and profiles [P]** (0.3, §2.1; D-107,
D-108). Apply the one viewer-aware visibility rule (seam 6) to runner search
and H: banned authors, accounts pending deletion, a blocked pair, and what
the viewer reported.
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

**FEED-10 · Handle placements [F]** (round 26 #7). After ACC-1, `@handle`
replaces the name everywhere, in **one style: Archivo 600, "@" included,
lowercase, never mono**: the feed author row, D, G, H, search (which moves
from mono) and S1 ("@x found your 41° run useful."). Profiles are reached
at `/`; an old handle shows "This runner changed their name." and
**never redirects** (a redirect would link old to new), reading 126's
handle history.

**FEED-11 · Unverified runners [F]** (round 26 #11; decision D-50). One
hairline band on Feed and You, no dismiss, while the runner is unverified.
Useful opens 126's "Confirm your email first" sheet instead of acting
(seam 7). There is no queued-share state: an unverified runner's entries are
simply private (126 saves them so), so no feed read changes.

**FEED-12 · The typed city: Find, then Use this [P]** (round 26 #12), on Your
conditions and on O1. The hint "Add the state or country. We'll show you the
place we found before we use it."; **Find** beside the field (Enter means
Find); "Weather for {resolved}" with **Use this** ("Not it? Add more to the
name."); nothing saved until Use this; the not-found field message and the
`NOT FOUND YET` band; on O1 the resolved string, uppercased, becomes the
chip with "Change city", and Next with an unconfirmed entry reads "Press
Find, or clear the field to skip."; Your conditions' header reads `WEATHER
FOR {RESOLVED}`. Round 26 gives O1's step to 126; it is here because you own
the place files and the one writer (FEED-5).

**FEED-13 · Round 26's feed confirms [P]** (#9, #18). E2-lite's "No weather
for {place} yet. It shows after the first reading."; a word label on each
consensus bar (colour is never alone, rule 10); "Find runners" as a
right-aligned text link; G's settings icon button (`settings`, named
"Settings") at the right of the identity line in every state, day one
keeping its inline link.

**FEED-14 · The entry's OG meta [P]** (round 26 #22; decision D-51). D's
head carries the title `@handle · {temp} {precip}, {verdict}`, the kit in kit
order as the description, and 125's card image (OPS-16); private, deleted,
banned or unverified entries carry the default. **The crawler is signed
out**, and 128's SAF-14 makes D's data require a session, so serve the head
meta alone to a signed-out request for a public entry, never the page's
data (open decision 7; default yes). Keep `noindex` (FEED-1): previews and
indexing are separate questions. Test: a signed-out request for a public
entry gets the meta and no entry data; a private one gets the default.

## Tests

Worker tests for FEED-2 to FEED-5, FEED-7, FEED-10's old-handle page and
FEED-14; ui tests for FEED-6, FEED-8, FEED-11 and FEED-13; conformance for
FEED-9 and round 26's "Handle placements", "City field …" and "O1 City step"
frames. Mutation stays at 100% on `modules/feed`,
`modules/notifications` and every `.tsx` you touch.

## Demos

`e2e/feed/`: Your conditions in the new wording; the bell counting an old
run; the author's under-review marker; `@handle` everywhere; the typed
city's Find and Use this; the unverified band.
