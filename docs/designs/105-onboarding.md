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
- **The climate band, revised twice while building, and both times by
  checking rather than by preference.**
  1. `climateBandFor(lat)` — latitude alone — was the plan. Its boundary
     was written as 45, which put Minneapolis (44.98) in `mild`: the
     packet's own worked example, failed by the code meant to satisfy it.
     Now 40/30, with `Math.abs` for the southern hemisphere.
  2. The owner asked whether latitude is reliable enough. It is not:
     against measured normals it is wrong for **four of five** cities
     (Phoenix, Seattle, Denver, Reykjavík). Visual Crossing answers this on
     the endpoint we already use — `include=stats` — so `resolveClimateBand`
     reads normals and **falls back to latitude**, which is why the
     heuristic stays rather than being deleted (law 5: onboarding must not
     block on a third party).
  Permission denied or no location → `mild`, and no provider call at all.
  Since round 6 the band only *orders* the list, so a wrong band costs a
  scroll rather than a garment.
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
- New route files: `src/routes/onboarding/{calibrate,taplist,done}.tsx` and
  `src/routes/call/index.tsx` are built; `{name,settings}.tsx` are P2.5 and
  the settings surface, still to come.
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

## What O3 became (design round 6, §AA)

The packet describes a per-band list. Design replaced that while this lane
was building: **one `TAP_LIST`, ranked per band, folded at 14**, and the
band never removes a row — *a Minneapolis runner owns tights and a
singlet*. `TapListForm` is built to the six rules that came with it; the
two that are easiest to lose are **nothing arrives ticked** (so the
component has no prop for a starting selection, deliberately) and **the
disclosure states the real remainder** (so nothing hardcodes design's "10
more", which was true of 24 rows and is not true of the 18 that exist —
D-49).

Two things that fell out of building it, both recorded at their sites:

- **`tapListSelectionSchema` moved to `lib/contracts.ts`.** The form needs
  the same schema object the server validates with, and a component may not
  import `modules/closet`'s barrel — it re-exports the service, which
  reaches `db/schema`. That is CLAUDE.md's own escape hatch for this exact
  case.
- **`addFromTapList` dedupes.** The screen holds a `Set`, so it was the
  payload it did *not* build — a retry, a hand-made request — that could
  create the same beanie twice. Deduping there is also what let the schema
  drop a length cap that was never the real bound.

## Open questions

Both resolved in build, and both touched files outside the packet's
ownership list with the owner's go-ahead:

1. **`src/modules/feed/index.ts` did not exist**, so "reads via the feed
   module's public API" had no API to read. Created, exporting the coverage
   read and nothing else.
2. **The Call tab linked to `/`** in `src/ui/TabBar.tsx`; it now reaches
   `/call`. D-31 (tab bar renders text, not glyphs) touches the same file
   and stays deferred to its own PR, because it is visible and wants its own
   demo.

**Settings landed as the first rows of design's U1**, which is a ten-row
index spanning account, privacy, blocked runners, notifications,
connections, export and delete. Three of those rows are this packet's —
how you run warm or cold, units, and the sharing default — and the rest
belong to other lanes and to D-32. The page is where they will join.

U1's rule is that every row states its current value, "a settings list you
can read without opening anything"; the calibration row honours it
literally, stating the answer *and* the offset, in whichever unit is
selected above it.

Still open: **nothing routes a new account into the flow** (D-52). Signup
lands on `/`, so O1 is reachable only by URL or from settings. Wiring it is
a product call with a demo-spec blast radius across four other lanes — the
options and their costs are in the register row.

## What shipped

Every screen the packet owns: **O1** (calibrate, with the visible offset
requirement 1 names — it had been a comment on `thermalLevelSchema` and
nothing read it), **O3** (the one list, design round 6 §AA), **P2.5** (make
them real, design round 7 §AC), **P3** (now go run), **settings** (the
three rows of design's U1 this packet owns), and the **Call teaser** (O6).

`/` sends a signed-in runner with `onboarding_complete` false to O1, so
bailing is recoverable — a signup-only redirect would strand exactly the
person the skippable design invites (D-52).

**D-48's redraw landed with it**: hue means verdict everywhere and
permanently, coverage became ink density, and the profile row stopped
carrying a three-way distinction on hue alone at 30% ink.

### What this packet could not finish, and why

- **D-54** — P2.5's payout lines. §AC3 makes the on-save moment the
  screen's argument "made literal", and all three lines need something that
  does not exist: `products.type` (lane 107), an owner count (no such read),
  O4's tagged runs. The row states what happened and stops.
- **The ranked heading in P2.5 is inert.** Rule 01 sorts by O4-tagged runs
  and O4 is out of scope, so rule 02's flat-list fallback is what every v1
  runner sees. Design wrote that branch, so it is their answer — but the
  screen shipped is the fallback, not AC1 as drawn.
- **D-49** — the tap list is 18 rows where design specified 24. Unspecified
  content, not structure: the fold, the ranking and the disclosure all work
  at any length.
- **D-57** — the onboarding demo needs a retry roughly one run in three,
  because a D1 write makes the dev server reload the page a few seconds
  later and wipe the taps. Recording only; CI is unaffected.
- **D-31** — the tab bar still renders text rather than glyphs, deferred to
  its own PR because it is visible and wants its own demo.
