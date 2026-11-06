# Design: 179 Shell, a11y and hygiene leftovers (wave 2)

## Problem

These items come from the Plan vs. Build survey (2026-11-05) and wave 1.
Each was re-read on `origin/main` 7a160a1a.

- System states miss parts of round 22 X1–X3: the bell, the root crash's
  Reload, and in-screen links that breathe.
- A few brackets are still read aloud.
- Two unions and two helpers are restated.
- Some tests are flaky or mix fake timers with `waitFor`.

## Approach

- **PR#104-1 · bell** (owner, 2026-11-06: fetch after mount).
  - `router.tsx` wires `bellStateFn` into `NotFound` and `RouteFailed` as a
    `loadBell` prop.
  - Signed in, `SystemFrame` calls it once after mount. It wraps the frame
    in `BelledLayout` when the call resolves, and in plain `Layout` until
    then or if it fails (law 5).
  - auth imports `BelledLayout` through `modules/notifications`' index.
- **PR#104-1 · root crash**.
  - When the root match itself is in `error`, `RouteFailed` renders
    `RootCrashed`. That is the band alone on paper, with no `onRetry`, and
    a "Reload" button as the band's child that calls
    `location.reload()`.
  - A lapsed session or the terms refusal is still checked first.
- **PR#104-1 · X3 links** (owner: primitive + non-feed; coordinator: feed
  too where lane 178 isn't editing).
  - `ui/slow-link.ts` adds `useTappedSlow()`. It returns
    `{ isWaiting, onClick }`: `onClick` marks this link as the tapped one,
    and `isWaiting` is `useSlowRoute().isSlow && tapped`. The mark clears
    when the load settles.
  - The label renders through the existing `PendingLabel`.
  - The announcement stays Layout's one `SlowRouteStatus`, so nothing is
    said twice.
  - Applied to the Settings index rows. For PostCard and OtherProfile's
    entry rows, Design has to say which text breathes; until then they go
    in Deferred.
- **PR#286-1**.
  - NotificationList's `[ Quiet ]` and BandHistory's `[band]` render
    through `Bracketed`, or get `aria-hidden` glyphs where Bracketed's step
    does not fit.
  - OwnProfile goes to lane 178 and ops `Today` to lane 176.
  - Wordmark, SubmitButton, BracketHeadline, VerdictForm and RunnerSearch
    already hide their brackets.
- **R-190**: `BandCoverage` and `CoverageLevel` become `= VerdictCoverage`.
- **R-184**: ParsedCard and ReportSheet import `focusOnMount` from `ui`.
  In ReportSheet only the import changes, and the local copy is deleted.
- **R-186**: closet-empty's tile-height test waits on `hydrated(page)`
  before it measures.
- **PR#113-2**: `weather/store.ts`'s `cacheKeyFor` calls `roundCoordinate`,
  and `roundCoord` is deleted along with its test (the rule's own test is in
  `lib/coords`).
- **PR#135**: the four DOM tests own their clock the way #135's upload test
  does: real timers around `waitFor`, and fake timers only where a test
  advances time itself.
- **PR#116** (owner: ask Design, build last): STEP n OF 4 is waiting on
  coordinator-2's batch to Design.
- **PR#104-2** (ink pill, buttonless band): built last, or only once the
  coordinator relays Design's answer.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**. `router.tsx` gets glue only.
- New bindings/queues/crons: **none**
- Screens: X1, X2, X3 (round 22), S (empty), U1 index, and possibly O0–O3
  (PR#116) and Au1–Au7 (PR#104-2).

## Test plan

- `system-state.dom`:
  - The bell appears once `loadBell` resolves.
  - There is no bell when `loadBell` rejects, and none when signed out.
  - A root error renders the band with Reload and no tab bar.
- `slow-link.dom`: under 300ms nothing breathes. Over 300ms only the
  tapped link breathes. A settled load clears it.
- `notification-list.dom` and the BandHistory test: the accessible text
  has no brackets.
- Type-level: R-190's aliases are covered by `tsc`. Existing
  ladder and Marks tests stay.
- e2e `system-states` conformance: the signed-in 404 has a bell.

## Deferred / register changes for coordinator-2

- **PR#136**: nothing left in scope. `schema-core.ts` is a forbidden
  zone, `safety/review.ts:750` is a fallow key, and coordinator-2 fixes
  R-103's path in the register pass.
- Retire R-184, R-186 and R-190 once merged.

## Open questions

- Design: which text breathes on a whole-card link (a post → D)?
