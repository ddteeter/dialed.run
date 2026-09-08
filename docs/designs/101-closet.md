# Design: 101 The Closet

## Problem

Runners build the closet: garment CRUD on category × layer, identity-first
capture (brand + model → canonical product), filters, detail stats, photos in
R2, and the tap-list seeding API lane 105 builds on. Screens C and F (v1).

## Approach

- `src/lib/normalize.ts` — identity normalization (NFKD, casefold,
  punctuation/whitespace fold) for brands/products.
- `src/lib/thermal.ts` — hand-built defaults table (category × weight × wind)
  → `estimateTempRange`; stored to `est_temp_*` on save when the user typed
  no explicit range.
- `src/modules/products/` — `service.ts` (brand/product create-if-missing on
  normalized identity, prefix autocomplete scoped `status='active'`),
  `seed-brands.ts` (~50 curated brands, idempotent runtime `INSERT OR IGNORE`
  seed — see open questions), `functions.ts` (server fns). Enrichment
  call-site is a documented TODO (lane 107 not merged).
- `src/modules/closet/` — `service.ts` (CRUD, retire-vs-delete, filters,
  detail stats: verdict summary, mileage, pairs-with, performance),
  `photos.ts` (photon pipeline), `tap-list.ts` (static per-climate lists +
  `addFromTapList`), `functions.ts`, `components/`.
- Pattern (mirrors modules/auth): server-fn glue lives in `functions.ts`,
  imported directly by route files; `index.ts` exports services + components
  and stays loadable in the vitest workers pool. Components take server-fn
  callbacks as props so the barrel never pulls TanStack virtual entries.
- Feed module is not merged: performance filter (most dialed ≥3 verdicts &
  ≥60% dialed; never worked ≥2 & 0 dialed; untested = no verdicts; retire
  candidate = last worn >180d) computes from `outfit_entries`/`runs` directly,
  always driven from `outfit_entries(user_id …)` so every scan is index-covered.
- Works-at temp filter uses the stored est range; the verdict-derived range is
  a seam (`workedRangeForItems`, returns empty today) because observations
  live in dialed-weather behind lane 103 — see open questions.
- Photos: multipart server fn → validate jpeg/png/webp ≤10 MB → original to
  `items/{userId}/{itemId}/original` first → photon-wasm (`@cf-wasm/photon`,
  workerd build) derives thumb 200 / card 600 / full 1600 webp. Benchmarked in
  the workers pool: 12 MP JPEG decode 167 ms, resize+encode ≈308 ms/size —
  ≲1.5 s CPU total, far under the 30 s paid-plan limit. Photo failure fails
  only the photo (item already saved; form offers retry). Served by an
  owner-scoped cached GET route.

## Contract touches

- Schema changes needed: **none**. Two non-blocking proposals for review:
  (1) brand seed as a data migration — migrations are a forbidden zone for
  this lane, so v1 seeds at runtime idempotently; the equivalent
  `INSERT OR IGNORE INTO brands …` migration can replace it. (2) optional
  index `outfit_entry_items(item_id)` if cross-user pairs-with ever ships;
  current queries avoid needing it.
- New route files (`src/routes/closet/`): `index.tsx` (C), `new.tsx` (F),
  `$itemId.tsx` (detail), `edit.$itemId.tsx` (F edit),
  `photo.$itemId.$size.ts` (image GET). `src/routes/products/`: none —
  autocomplete is server functions, not URLs (route conventions note).
- New bindings/queues/crons: **none** (PHOTOS R2 binding already exists).
- Screens: C, F (v1 identity-first, D-27/D-28/D-30); tap-list API for 105.

## Test plan

- Unit: garment union codec per category; thermal defaults; normalization
  collisions; tap-list validation.
- Integration (workers pool, real D1/R2): CRUD roundtrip; retire-vs-delete
  (referenced ⇒ retire only); cross-user read/mutate denial; product
  create-if-missing shares one row across users; brand seed idempotency;
  photo pipeline stores original + 3 sizes and benchmarks one 12 MP photo;
  tap-list creation (`origin='taplist'`).
- Component render (SSR): closet page groups/nudge/empty state; garment form
  renders category-appropriate attribute fields; detail temp band
  `[UNTESTED]` vs verdict summary.

## Open questions

1. Brand seed via runtime idempotent insert instead of the packet's
   "migration-seeded" wording — migrations are human-managed; veto if you'd
   rather apply the data migration yourself.
2. Works-at filter ships est-range-only until weather (103) exposes
   observations; verdict-derived range plugs into the documented seam.
3. Photo GET route is owner-only (`Cache-Control: private`); revisit when
   another lane needs garment photos.
