# Design: 054 run-span conditions (closes D-5)

## Problem

A run that spans 4°C → 12°C is remembered as a 4°C run: every reader
resolves `cacheKeyFor(lat, lng, startedAt)` and takes the first hour. The
verdict covers the whole run, so a "way warm" on that run teaches the call
epic that 4°C means overdressed.

**Half of D-5 is already done and the register is stale.** `db1e0c6` made
`attach.ts` resolve *every* hour a run spans (capped at 6), so the
observations exist in `DIALED_WEATHER` today. It deliberately stopped
before deciding which value represents a run, because that is a product
call. This lane is that decision plus the read side. **It is not a schema
change** — observations are a shared cache keyed by rounded lat/lng/hour,
so a run's span is derivable from `started_at + duration_s`.

## Approach

**Owner's calls (2026-09-11):** a run is judged at its *worst hour relative
to its verdict*, and *displays as a range*.

- `feed/conditions.ts` — `Conditions` gains `span: { minFeelsLikeC,
  maxFeelsLikeC, minTempC, maxTempC }`. `tempC`/`feelsLikeC` keep meaning
  **the starting hour**, so nothing that reads them today moves.
  `observationsForRuns` reads every hour key the run spans instead of one,
  which is why `Locatable` gains `durationS`.
- `feed/judged-conditions.ts` (new, plain sibling — no server imports) —
  `judgedFeelsLikeC(conditions, verdict)`:
  - `verdict < 0` (felt cold) → `span.minFeelsLikeC`
  - `verdict > 0` (felt warm) → `span.maxFeelsLikeC`
  - `verdict === 0` or `null` → `feelsLikeC`, the hour they dressed for
- Four banding sites move to it: `profiles.ts:109` (coverage ladder),
  `entries.ts:331` and `:365`, and `consensus.ts`'s window test — on the
  **entry** side only. A viewer's live conditions have no verdict, so the
  viewer stays a point; the comparison becomes "the temperature this runner
  actually judged by" against "the temperature you are in now".
- Display: `Feed.tsx` and `EntryDetail.tsx` render the span through the
  existing `Bracketed` primitive — `[4–12°]` where they render `[4°]` now.
  A single-hour run has `min === max` and renders `[4°]` unchanged.

## Contract touches

- Schema changes needed: **none** — the observations already exist per
  hour; this reads more of them.
- New route files: none.
- New bindings/queues/crons: **none**.
- Screens: no new screen. Feed card and entry detail change what they show,
  so this needs a demo re-record. No new design language: bracket notation
  for a measured range is what `bandLabel` already renders ("38–46°"), so
  no `docs/design-deltas.md` entry.

## Test plan

- `judgedFeelsLikeC`: cold verdict takes the min, warm takes the max,
  dialed and unrated both take the start — unit, and the table is pinned
  against `verdictScale` so the sign convention cannot drift.
- `observationsForRuns`: a 3-hour run reads three cells and reports the
  span; a 1-hour run reports `min === max`; a run whose later hours are
  missing from cache still reports a span over the hours that exist —
  integration, workers pool.
- `coverageLadder`: a 4→12° run with a "way warm" verdict lands in the 10°
  band, not the 0° band — integration. This is the regression D-5 names.
- `itemWearInBand`: an **unrated** entry still bands, at its start hour.
- `isWithinConsensusWindow`: an entry matches on its judged hour, not its
  first.
- Feed card and entry detail render `[4–12°]`, and `[4°]` when the run
  fits one hour — dom.

## Open questions

- **Dialed and unrated fall back to the starting hour**, which the owner's
  choice implies rather than states: a dialed run has no "worst", and an
  unrated one has no verdict to be worst relative to. Proceeding on that;
  the alternative is excluding dialed runs from coverage, which would empty
  the ladder of exactly its success cases.
- `prefill.ts` matches a candidate entry on `feelsLikeC`. It is left on the
  starting hour in this lane: prefill answers "what did I wear last time it
  felt like this *when I set out*", which is the point a person is at when
  they open the app. Flagged rather than assumed — say so if it should move.
