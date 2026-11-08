# Design: 188 desk safety

> Wave 4 lane desk-safety, drafted 2026-11-08. Items #490, #388 and #497.
> #447 (PhotoDNA) and #362 (CSP enforcement) stay held: one needs a
> provider account and a secret, the other the friends stage's reports.

## Problem

Opening Review or the takedown queue asks D1 a statement count that grows
with the rows: core is 9 + 5N for N fingerprinted photo rows, about 500
statements at the page cap (#490). And an operator checking copies cannot
open a private or hidden kit in place, because every "open the kit" link
goes to `/feed/entry/$entryId`, which treats them as any runner (#388,
R-154). Round 50 · 145 adds the reporter count to the WHO REPORTED fold's
label (#497).

## Approach

**#490: one statement per helper, whatever the page holds.** Each helper
takes its subjects as **one bound JSON parameter** read with `json_each`,
so the statement neither grows a placeholder per subject nor needs
`IN_LIST_CHUNK` (D1's cap is on bound parameters, and this binds one).
Grouping and per-subject limits stay in SQL, with window functions.

- `other-photos.ts`: one select over `json_each(subjects)`, the runner
  still the live-or-recorded subquery per subject; `row_number() over
(partition by subject)` keeps `OTHER_PHOTOS_LIMIT`, `count(*) over
(partition by subject)` is the total. EXPLAIN still shows index probes.
- `photo-matches.ts`: one read of every subject's fingerprints (a photo or
  a kit's photos), then one batch of two searches for all of them. The
  distance today is spelt per fingerprint into the SQL, which for 100
  subjects would pass D1's 100 KB statement size; the new searches compare
  two columns instead — `lib/sql/fingerprint-distance.ts` gains a
  column-to-column distance (per hex digit, popcount of `x ^ y` from a
  16-entry table), pinned against `digitDistances` by a test. The photo
  table is the outer loop (`CROSS JOIN` order), so each photo is read once,
  as today. Per subject: the nearest over its prints, ranked, limit + 1
  kept for `isCutOff`.
- `removed-fingerprints.ts`: `removedMatchesOf`'s per-photo
  `removedImagesNear` becomes one select joining the kept rows to the
  page's distinctive prints. `removedMatchOf` (the upload path) is
  unchanged.
- `test/safety/desk-queues.scaling.test.ts` asserts equal counts for 1
  and 25 rows, as `flat` does for the single-read lists.

**#388: an admin kit view at `/desk/kit/$entryId`.** Under `/desk` beside
`review-photo`, so the Desk's door (`beforeLoad`) and layout cover it. A
safety server function reads the kit whatever its audience or moderation
state behind `requireAdmin` on the verified id; a removed kit says so. Its
photos come through `/desk/review-photo/` (`reviewPhotoSrc`). `OtherPhotos`
links every photo there (the `canOpen` split goes), `PhotoMatches`' kit
tiles likewise, and `RemovalRequests`' "Open the kit" points at it.
**No board: built on a marked guess** (design ask sent to coordinator-4):
the Desk's existing primitives, the kit's runner, audience and state in a
mono band, then the photos, garments and verdict.

**#497**: `WHO REPORTED · 4 ▸` in `WhoReported.tsx`, after design 183
merges.

## Contract touches

- Schema changes needed: **none**
- New route files: `src/routes/desk/kit.$entryId.tsx`
- New bindings/queues/crons: **none**
- Screens: Review (D1), takedown requests; one new undesigned Desk screen.

## Test plan

- worker: scaling tests flipped to equal counts (review photo rows, entry
  rows, takedown requests); the existing `other-photos`, `photo-matches`,
  `removed-fingerprints` suites unchanged in what they assert, plus
  multi-subject cases (two subjects on one runner, limits per subject); the
  column-to-column distance against `digitDistances` for every digit pair.
- worker: the kit read — a private kit, a hidden one, a removed one; a
  non-admin refused; a verification-class row for the new server function.
- dom: the kit view's states; OtherPhotos/RemovalRequests link targets;
  the WHO REPORTED count.
- e2e: the Desk journey opens a private kit from Review (a new route
  behind the existing gate, so no redirect spec).

## Issues

- Closes: #490, #388, #497.
- Opens: the design ask for the kit view (via coordinator-4).

## Open questions

- Guess: `/desk/kit/$entryId` rather than `src/routes/safety/` (the issue's
  "Where"), since every operator screen lives under `/desk`.
