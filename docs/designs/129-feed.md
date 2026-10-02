# Design: 129 Feed (launch development)

## Problem

The feed lane's launch items (`docs/tasks/129-feed.md`): the following feed
must survive a runner who follows more than 92 people (R-101), the bell must
count every run still owed a verdict, the profile city must have one writer,
the typed city must be found and confirmed before it is used (round 26 #12),
and round 26's feed confirms and indexing default must land. Several items
build on PRs that are not merged yet; those are sequenced, not guessed at.

## Approach

- **FEED-4** — `followingFeedStatement(db, viewerId, cursor)` scopes by
  `user_id = ? OR user_id IN (SELECT followee_id FROM follows WHERE
follower_id = ?)`. Two bound ids however many follows. EXPLAIN before and
  after goes in the PR; a test pins "no SCAN" on both tables at 150 follows.
  **Revised in review (PR #117):** that shape still seeked
  `entries_public_created` across every runner and checked each author row
  by row. The statement now drives from the authors — followees plus the
  viewer as a constant row, `CROSS JOIN`ed to each author's newest `limit`
  entries past the cursor — on a new additive index,
  `entries_user_public_created (user_id, is_public, moderation_status,
created_at)` (migration `0026_add_entries_user_public_created_index`).
  The cursor predicate leads with `created_at <= ?` so each seek starts at
  the cursor. Rows scanned: at most a page per author.
- **FEED-3** — `bellState` takes the awaiting set from `runsAwaitingVerdict`
  (passed in by `bellStateFn`: notifications → runs → notifications would be
  a cycle), read with `limit = cap + 1` since the bell stops at `9+`. The
  14-day window goes from mark-all and `markable` too. Names: "Notifications"
  and "Notifications, {n} new".
- **FEED-5 / FEED-12 / FEED-2** — one writer, `savePlace` in
  `onboarding/profile.ts`, exported by a new `onboarding/index.ts`. In
  review both callers were put on one statement: `placeWrite` is the only
  thing that writes the three place columns; `savePlace` awaits it and
  `saveCalibration` batches it with the thermal answer and units. O1's
  "press Find" rule is a `superRefine` on `calibrationInput`, so the server
  refuses an unconfirmed city too. Find is
  one server function (`lookUpCityFn`, O1's, now wired to `resolvePlace`)
  answering `found {address, lat, lng}` / `not-found` / `unavailable`. A
  shared `CityFinder` (onboarding components, exported through the index)
  draws field + Find → "Weather for {resolved}" + Use this; nothing saves
  until Use this. Your conditions saves through `savePlace`; O1 turns it into
  the chip and saves with the calibration. `WEATHER FOR {RESOLVED}` heads
  Your conditions whenever a named place is in use.
- **FEED-1** — `head` on D and H from a `route-decisions.ts` constant:
  `<meta name="robots" content="noindex">`.
- **FEED-8** — `WeatherAttribution` beside every conditions display: the
  card (outside its link), D's strip, and Your conditions' result states.
- **FEED-13** — E2-lite "No weather for {place} yet. It shows after the
  first reading."; a word on each consensus bar; G's `settings` icon button.
- **Manual source** — feed's two `ne(source, "manual")` filters go, and
  with #112 merged `'manual'` leaves the column's enum (TS only, no SQL).

## Contract touches

- Schema changes needed: `weather_observations.source` loses `'manual'`
  (owner-approved; TS enum only, no migration).
- New route files: none. Bindings/queues/crons: **none**.
- Screens: E1, E2-lite, D, G, H, S2 bell, O1 city step, round 26 #9/#12/#18.

## Sequenced (not in this PR)

FEED-14 is descoped (owner, 2026-09-26: entries are for signed-in runners
only, and every link previews as the generic card). FEED-6/7
(128's predicate, 126's deletion state), FEED-10 (126's usernames), FEED-11
(126's verification). Landed once their PRs merged: US date order (#113's
formatter, shared through `lib/dates`), coordinate rounding in `onboarding/inputs.ts`
(#113's `roundCoordinate`, so both O1 and Your conditions store two decimal
places), the enum drop (#112).

### Follow-up PR (after #116 and #118): FEED-6, 7, 10

- **FEED-7.** H's entries use `publiclyVisibleEntry(viewerId)`. H and
  runner search drop a banned runner (`banned_at IS NULL`), anyone in a
  block pair with the viewer (`notBlockedEitherWay`, now exported by
  `modules/safety` and taking the runner column, so entries and profiles
  share one gate), and — for the reporter alone — a runner whose profile
  they reported (`profileNotReportedBy`, D-68). All in the `WHERE`, ahead
  of the `LIMIT`; the search, H-runner and H-entries plans are pinned
  (`blocks_pk` and `reports_one_per_reporter` probes, never a scan).
  H of a hidden runner answers `undefined`, which the route already reads
  as "back to the feed". "Accounts pending deletion" has no state to read
  yet (128 deletes immediately), so there is nothing to filter.
- **FEED-6.** `getEntryDetail` and each Following item carry `underReview`
  from `isUnderReviewForAuthor`; the card and D render one placeholder
  `[UNDER REVIEW]` (`UnderReview.tsx`). The author's own under-review
  entries stay in their Following feed (D-67): the authors subquery gives
  the viewer a second row asking for `hidden_pending_review`, so the seek
  on `entries_user_public_created` keeps `moderation_status` an equality.
- **FEED-10.** One `Handle` component (Archivo 600, "@", as stored) on the
  author row, D's heading, G, H and search. `/@{$handle}` is a top-level
  route (the URL is the ruling's); `profileAtHandle` reads `lookUpHandle`
  and answers runner / own / changed / nothing, and `orHandlePage` sends
  own to G and nothing back to the feed. `/feed/u/$userId` now
  redirects to the runner's current `/@handle` through a handle-only read
  (`visibleRunnerHandle`, the same gate as H), so there is one H. S1 ("@x found your … run useful")
  is not built — there is no useful notification to style.
- **FEED-11** stays sequenced: 126's verification has not landed.

### Follow-up PR: FEED-11 (and SAF-15's verification half), seam 7

126's pieces were on main and called by nobody but U1. Wired:

- **The band** is `account`'s `ConfirmEmailBand`, composed by the Feed
  and You routes from the signed-in runner's address (`ownAccountQuery`,
  one read of the `user` row — no password lookup — run in parallel with
  each route's other loader reads, as on D and H) and passed to `Feed`
  and `OwnProfile` as a `confirmBand` node, which each renders first in
  its column. The band
  draws nothing once the address is confirmed, so neither screen decides.
  Copy is round 27 #7's: "…to share runs with other runners."
- **Useful.** `setUsefulReaction` asks `account`'s `isVerified` first and
  answers `{ status: "unverified" }`, writing nothing — before the
  visibility check, so the refusal says nothing about the entry. A set
  answers `{ status: "set", useful, count }`. On the client every press
  asks the server, and only its refusal opens the screen's "Confirm your
  email first" — a page whose loader saw an unconfirmed address must not
  refuse a runner who has since confirmed in another tab.
- **Report** (128's SAF-15, same seam). `fileReport(input, gate)` takes
  the check as a required argument and asks it before anything is
  written, the block included; `fileReportAction` passes `account`'s
  `isVerified`. Safety's barrel does not import `account` (that would be
  a cycle through `ops`), and no caller can file without a gate. W1
  opens for anyone; the server's refusal reaches `useFormSubmit`'s new
  `refusal` path — not a success, so no "Report sent." and W1 stays as it
  was, and not a failure, so no band — and opens the confirm sheet.
- **One gate per screen, composed by the route.** Feed and safety may
  not import `account`'s components, so the route builds a
  `ControlGate<Trigger>` (`ui`) from `account`'s `confirmEmailGate`: a
  render function for the sheet. `useControlGate` gives the screen one
  sheet and each control a guard, `ask(trigger)`; D's Useful and report
  share one, and the trigger picks round 27 #17's lead sentence. The page
  knows the address only to draw the band; the server alone decides
  whether a control may act.
- **The sheet** takes round 27 #17's lead sentence by trigger and its
  **Not now**, which has focus. Design deltas, item 41.

## Test plan

- worker: 150-follow feed page + cursor + EXPLAIN; bell counts a 30-day-old
  run; mark-all keeps an old owed reminder; `savePlace` writes all three or
  none, from both paths; O1 lookup returns the resolved address.
- ui: CityFinder (Find, Enter, not found, band, Use this), O1 chip + Next
  message, ConditionsTab header / no-weather copy / bar words / attribution,
  PostCard + EntryDetail attribution, G settings button, bell names.
- e2e: feed demo and E2 conformance extended; noindex on D and H.

## Open questions

- Bell dot state: the ruling names two states; the dot reads
  "Notifications, {unread} new" (digits) — flagged as a design delta.
- Bar word labels ("Most" / "Some") are placeholder copy.
