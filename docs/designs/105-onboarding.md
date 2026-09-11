# Design: 105 onboarding & call teaser

## Problem

A new account is an empty closet and no idea how warm the person runs, so
nothing the app does is useful. O1 → tap-list → P2.5 → "now go run" gets
them to a working closet in under two minutes, and the Call tab shows an
honest ladder instead of a promise.

## Approach

`src/modules/onboarding/` owns the flow; `src/routes/onboarding/` and
`src/routes/call/` are its routes. It consumes `closet` (`addFromTapList`,
`TAP_LISTS`) and `auth` through their barrels.

- **`thermalScale` joins `lib/contracts.ts`**, next to `verdictScale` and
  shaped like it: `{ value, token, label }` ×5, +2 "Always freezing" …
  −2 "Sweating in a t-shirt at 40°". Today that mapping lives in a *comment*
  on `thermalLevelSchema`, and onboarding plus settings-recalibrate would
  otherwise each restate it. Pinned against `thermalLevelSchema`'s range.
- **`climateBandFor(lat)`** in `onboarding/climate.ts`, documented at the
  site: |lat| ≥ 45 → `cold`, ≥ 30 → `mild`, else `hot`. Latitude alone, no
  table — the packet allows "rough … from latitude", and Minneapolis (45.0)
  landing `cold` while Phoenix (33.4) lands `mild` is the case it names.
  Permission denied or no location → `mild`, the band whose list is a
  superset of neither extreme.
- **Steps are routes, not a wizard component**: `/onboarding/calibrate`,
  `/thermal`... each writes on submit and redirects, so a bail keeps what
  was answered. `onboarding_complete` flips only at P3.
- **Call teaser** reads `ownProfile`'s existing `coverage: CoverageBand[]`
  (already per-5°C with cold/dialed/warm counts) and compares the verdict
  total against `CALL_VERDICT_THRESHOLD`. No new band maths.

## Contract touches

- Schema changes needed: **none.** `onboarding_complete`, `city_label`,
  `thermal_level`, `temp_unit`, `distance_unit` all already exist — checked
  before designing, since requirement 6 reads like it wants a new flag.
- New route files: `src/routes/onboarding/{calibrate,taplist,name,done,
  settings}.tsx`, `src/routes/call/index.tsx`.
- New bindings/queues/crons: **none.**
- Screens: O1, O3, O6 (ladder), P3. **P2.5 has no artboard** — product.md
  already says "needs design", so it ships under the placeholder protocol:
  existing `ui/` primitives only, and an entry added to
  `docs/design-deltas.md`'s open queue in the same PR.

## Test plan

- `thermalScale`: pinned against `thermalLevelSchema` in both directions.
- `climateBandFor`: Minneapolis cold, Phoenix mild, equator hot, southern
  hemisphere symmetric, no-location falls back to mild.
- O1 writes `thermal_level`/`city_label`/`lat`/`lng`/units; a denied
  permission still completes the step.
- Tap-list creates `origin='taplist'` rows; skip creates none.
- P2.5 upgrades a taplist row (brand+name, origin → `manual`); skip leaves
  it generic.
- `onboarding_complete` gates re-entry; settings "recalibrate" reaches O1
  without re-running the rest.
- Ladder: bucket counts, the 0-verdict state, and threshold-reached copy.

## Open questions

Two touch files this packet does not list as mine, and both are implied by
requirement 5 rather than optional. Proceeding, flagged for veto:

1. **`src/modules/feed/index.ts` does not exist**, so "reads via the feed
   module's public API" has no API to read. I intend to create it exporting
   the coverage read only. That fixes feed's public surface, which is
   arguably the feed lane's call.
2. **The Call tab links to `/`** in `src/ui/TabBar.tsx`. A Call route that
   the Call tab does not reach is not the requirement. D-31 (tab bar renders
   text, not glyphs) touches the same file and is folded in.

Also: no settings surface exists yet from 104, so `onboarding/settings.tsx`
is the first, and owns units + share default + recalibrate.
