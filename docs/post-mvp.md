# dialed.run — Post-MVP Epics

Documented so v1 agents don't build toward the wrong future, and so the seams
built now (D-25) have a named payoff. Nothing here is scheduled; the call
epic is first. Packets get written with the standard template when an epic
opens.

## Epic 200 — The Call (first; the design's Milestone 1, deferred by D-01)

The recommendation engine and everything that feeds it. Spec already exists:
design screens B1/B2, O2, O4, O5/O6 and the Onboarding artboard's
"what has to exist behind this" table.

- **Engine**: blended prior — published dressing heuristic floor + thermal
  offset + garment attributes/est ranges + personal verdict history + cohort
  distribution. Small model over structured features; auditable and
  correctable. **Explicitly no LLM narration of guesses** (design rule).
  Confidence computed per temp band × condition class; drives the ladder
  copy, source weighting, and what to ask next. Input: task 090's findings.
- **Surfaces**: B1 (plan the run) + B2 (the answer, every item carrying its
  evidence), Call tab replaces the teaser, "swap a layer", "why not the X".
- **Kits** (D-09): kits/kit_items tables, save-as-kit, try-this-kit on post
  detail, profile kits row.
- **Vision capture** (D-08): O2 shoot-the-closet + F auto-read — photo →
  category/attributes via a vision model; corrections are training data.
  Model eval required before it ships.
- **Bulk import, re-evaluated** (D-13): value is conditions-distribution +
  optional extreme-run tagging — decide then whether it's worth the weather
  backfill budget (throttled queue against Visual Crossing free tier, or pay).
- **Intensity from imported files** (raised in the PR #4 review): `.fit`,
  `.tcx` and `.gpx` uploads carry heart rate, cadence and sometimes power,
  and the parsers currently read distance and duration and drop the rest.
  How hard someone ran plainly belongs in a dressing recommendation — the
  same conditions and the same kit feel different at easy pace and at
  threshold — and today the only intensity signal is the user-entered
  `effort` enum, which most people will not set.
  **The asymmetry is the interesting part, and it is worth deciding
  deliberately rather than discovering.** CLAUDE.md's rule is that *Strava*
  activity data is never stored; that is a compliance constraint from
  Strava's API terms, not a privacy position. A user uploading their own
  `.tcx` is a different situation in every respect: it is their file,
  handed to us directly, with no third-party terms attached. So we *may*
  store intensity for file-importers and *may not* for Strava-connected
  users — which means recommendations would quietly be better for one group
  than the other. That is a product decision (accept the split? ask Strava
  users to self-report effort? ignore intensity entirely for parity?) and
  it should be made before the engine depends on it.
  Note also that imported files are retained for 30 days
  (`docs/deployment.md`), so anything wanted long-term has to be extracted
  at parse time, not recovered later.
- **Cohort model**: aggregates by climate zone, offset, effort. Geographic
  density matters — city-by-city launch argument lives here.
- **Forecast**: `WeatherProvider.forecast()` is already in the contract.

## Epic 201 — Full social

- Full E2 (stranger cards, conditions-proximity ranking, follow CTAs) (D-10).
- Discovery I: overlap %, offset comparison, "why she's useful to you",
  the colder/warmer/same trio framing (D-18).
- H profile's offset-translation block.
- Comments, revisited (D-04): only with report→hide→review extended to them;
  the design's D artboard is the spec.

## Epic 202 — Gear gaps (design J; design Milestone 4)

Gated behind 15+ verdicts/user and unambiguous data. Categories, never
products; evidence shown; retirement suggestions included; "NOT PAID" chip
flips to a disclosure if affiliate ever arrives. Needs the conditions
distribution from 200. The affiliate engine itself is a separate, later
decision.

## Epic 203 — Offline / PWA (D-07)

Service worker: cached closet reads, queued run logging + verdict submission
with background sync, `[QUEUED]` states per the flow map. The v1 rule that
nothing precludes this must be re-verified at epic start.

## Epic 204 — Platform expansion

Polar/Fitbit adapters behind `RunSource`; Garmin API if the program reopens;
iOS app (unlocks Apple Health); laundry state (the design's "sleeper feature"
— the reason a recommendation is sometimes unavailable; pairs with the call).

## Standing note

None of these justify speculative abstraction in v1. The only pre-built
seams are the ones in D-25.
