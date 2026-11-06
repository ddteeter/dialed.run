# Design: 174 Closet filter rail (R-94)

## Problem

Closet C is one column at every width because its rail (round 16: GROUP with
counts, WORKS AT, COVERAGE) is drawn but not built, and R-94 makes it
all-or-nothing. This lane builds all three groups as real filters: a rail at
desk and chips above the grid below 1040.

## Approach

- **State is the URL.** `closetSearch` (`modules/closet/inputs.ts`) grows
  `group` (a `uiGroups` value), `from`/`to` (whole °C) and `coverage`
  (`covered | partial | untested`) beside `retired`. Each one is parsed
  separately, and a bad value is dropped, not refused, as `retired` is
  today. The loader doesn't depend on them, so changing a filter
  re-renders and doesn't refetch.
- **Filtering is one pure file**, `modules/closet/filters.ts`, with no
  server imports so the component can use it. `filterViews(views, filters)`
  narrows the listing. `railCounts(views)` counts per group and per coverage
  level over the pieces the retired switch admits, *not* faceted by the
  other filters (board C: coverage sums to the "All" count while Tops is
  set). `worksAtSpan(views)` returns the slider's bounds: the closet's own
  lowest low and highest high.
  `shouldIncludeByTempFilter` moves here from `service.ts` (service imports
  it back), so the overlap rule exists once.
- **Coverage is the ladder's rule** (Drew, 2026-11-05): 3+ verdicts covered,
  1–2 partial, 0 untested. `coverageOfVerdicts(n)` goes into
  `lib/contracts/profile.ts` beside `BAND_COVERED_VERDICTS`, and
  `onboarding/ladder.ts` `bandCoverage` calls it (coordinator-approved, one
  line). A garment's "untested" is the ladder's "unknown". The swatch is
  `CoverageMark`, ink only (§AB).
- **Components** (`modules/closet/components/`):
  - `ClosetFilters.tsx` holds the three groups. GROUP and COVERAGE values are
    `Link`s with `aria-current`, so they work before hydration. WORKS AT is
    two `type="range"` inputs (from/to, step 1°C) that navigate on `change`.
    The selected span is filled in **ink** (Drew: the board's pink loses to
    its own note).
  - Desk: `ClosetGrid` becomes two columns, with the rail as
    `desk:grid-cols-[max-content_minmax(0,1fr)]`. No rail-width token exists,
    and the contract is never measured.
  - Below desk the same groups render as a chip row. WORKS AT is one chip,
    `WORKS AT [34–58°]`, a `<details>` that opens the same range control
    inline (Drew).
  - Hooks stay under the complexity gate through `useClosetFilters`
    (search → filters + navigate) and sub-components per group.
- **Header**: `47 pieces` until a group is set, then `14 tops`
  (`uiGroupLabels`, lower-cased). A mono `FILTERED: [34–58°] · COVERED`
  line appears when WORKS AT or COVERAGE is set. The retired switch and the
  generic nudge stay where they are.
- `ClosetFilters` is not `DeskSplit`: that rail is read-only by contract,
  and this one is only controls.

## Contract touches

- Schema changes: **none**. Bindings/queues/crons: **none**.
- New route files: none (`routes/closet/index.tsx` passes search + navigate).
- Outside closet (approved): `lib/contracts/profile.ts` (+`coverageOfVerdicts`),
  `modules/onboarding/ladder.ts` (one call).
- Screen C (Product Screens C, Desktop Contract C row), R-94.

## Test plan

- worker/unit `test/contracts/coverage-of-verdicts.test.ts`: 0, 1,
  T−1, T, T+n against `BAND_COVERED_VERDICTS`. Existing ladder tests stay green.
- unit `closet-search.test.ts`: each param parses, bad values are dropped, and
  `from > to` is dropped.
- unit `closet-filters.test.ts`: `filterViews` per group, temp overlap,
  coverage; `railCounts` ignores the other filters and honours retired;
  `worksAtSpan` with no ranges.
- dom `ClosetFilters.dom.test.tsx`: links carry `aria-current` and target
  hrefs; counts; the range navigates on change; the chip shows the span.
- dom `ClosetGrid.dom.test.tsx`: header follows the group; FILTERED line.
- e2e `closet-filters.spec.ts`: desk rail filters the grid; phone chips;
  also the demo video.

## Open questions

- Guess I'm proceeding on: the WORKS AT range needs JS. Every other filter
  is a plain link, and a range with no script would need an Apply button the
  board doesn't draw.
- °C everywhere, matching what the tiles print today. The closet doesn't
  convert to the runner's unit yet, and that is outside this lane.
