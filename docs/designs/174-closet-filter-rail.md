# Design: 174 Closet filter rail (R-94)

## Problem

Closet C is one column at every width: its round-16 rail (GROUP with counts,
WORKS AT, COVERAGE) is drawn but not built, and R-94 makes it all-or-nothing.
This lane builds all three as real filters, as a rail at desk and as chips
above the grid below 1040.

## Approach

- **State is the URL.** `closetSearch` (`closet/inputs.ts`) gains `group`
  (`uiGroups`), `from`/`to` (°C to a tenth) and `coverage`, beside
  `retired`. A bad value is dropped, not refused. The loader doesn't depend
  on them, so a filter change re-renders without a refetch.
- **One pure file**, `closet/filters.ts`, with no server imports.
  - `filterViews` narrows the listing.
  - `railCounts` counts per group and coverage level over what the retired
    switch admits, not faceted (board C: coverage sums to All while Tops is
    set).
  - `worksAtSpan` gives the control's bounds, from the closet's own lowest
    low to its highest high.
  - `shouldIncludeByTempFilter` moves here from `service.ts`, so the overlap
    rule exists once.
- **Coverage = the ladder's rule** (the owner, 2026-11-05): `coverageOfVerdicts`
  in `lib/contracts/profile.ts` (3+ covered, 1–2 partial, 0 untested), which
  `onboarding/ladder.ts` now calls too. The swatch is `CoverageMark`, ink
  only (§AB).
- **`ClosetFilters.tsx`, `WorksAt.tsx`** (round 46 #109 rulings): before
  hydration GROUP and COVERAGE are links (`aria-current`), and WORKS AT
  is a GET form: visually hidden "Lowest"/"Highest", whole degrees in the
  runner's unit, a plain-text Apply, other filters as hidden fields, and
  `unit`. Once hydrated, COVERAGE becomes `aria-pressed` toggles (pressing
  the pressed one clears it) and WORKS AT becomes its bar (two range
  thumbs, ink span, committed on release); `Any` becomes a button that
  focuses the label. Desk layout is `desk:grid-cols-[max-content_minmax(0,1fr)]`,
  because no rail-width token exists. Below desk (#109b) there is one chip
  per group, `GROUP · VALUE` (ALL / ANY), each opening its control under
  the row with one open at a time; before hydration all three are open.
  This rail is not `DeskSplit`, whose rail is read-only by contract.
- **Units**: the control works in whole degrees of the runner's `temp_unit`,
  and the URL holds °C (`tempInUnit`/`unitToC`, `lib/contracts/temperature.ts`).
  **Bug fixed on the way:** `thermal.ts` `formatTempRange` took no unit, so
  °F runners saw °C ranges throughout the closet. The unit is now required,
  and the closet routes load `viewerUnitsQuery`.
- **Header**: `47 pieces` until a group is set, then `14 · Tops` (the owner: one
  rule, since "Hands / head" doesn't pluralise). A mono
  `FILTERED: [34–58°] · COVERED` line shows while WORKS AT or COVERAGE is
  set.
- **Clearing** (the owner): GROUP keeps its drawn All. Tapping the selected
  coverage level again clears it, and WORKS AT shows an `Any` link while a
  range is set (#109f confirms both). **No matches** (the owner; #109d): the line
  "Nothing in your closet matches these filters." with `Clear filters`, and
  focus goes to the header count.

## Contract touches

- Schema, bindings, queues, crons: **none**. New route files: none.
- Outside closet (coordinator-approved): `lib/contracts/profile.ts`,
  `lib/contracts/temperature.ts`, `lib/contracts/thermal.ts`,
  `modules/onboarding/ladder.ts` (one call).
- Screen C (Product Screens C, Desktop Contract C row); R-94.

## Test plan

- unit `test/lib/verdict-coverage.test.ts`: 0, 1, T−1, T, T+1 against
  `BAND_COVERED_VERDICTS`.
- unit `test/lib/temperature.test.ts`: every whole degree in −60…130°F and
  −50…55°C round-trips. `thermal.test.ts` covers °F at both ends and at
  each open end.
- unit: `closetSearch` per param, bad values dropped, `from > to` dropped;
  `filterViews`, `railCounts` (unfaceted, retired-aware), `worksAtSpan`.
- dom: links' `aria-current` and hrefs, counts, the form's GET fields and
  its change-navigation, the chip's span, the header and FILTERED line.
- e2e `closet-filters.spec.ts`: desk rail and phone chips filter the grid;
  it doubles as the demo video.

## Open questions

None. The owner settled coverage, the fill, the header, clearing and the no-match
copy (2026-11-05). The coordinator corrected units and the no-JS form, and
round 46 (#109a–m) ruled the rest.
