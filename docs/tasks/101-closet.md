# Task 101 — The Closet (parallel lane)

## Goal

Runners build their closet: garment CRUD on the category × layer model, with
condition/performance filtering and an optional photo per item in R2.
Implements screens C and F (v1 variants — see docs/design-deltas.md #12).

## You own

- `src/modules/closet/**` and `src/modules/products/**` (brands, product CRUD,
  autocomplete — the enrichment pipeline behind products is lane 107's)
- `src/routes/closet/**` and `src/routes/products/**`
- Tests under `test/closet/**` and `test/products/**`

You consume (read-only): `db` schema as-is, `ui`, `lib`, `env`, auth session.
**No schema changes are expected for this lane** — the tables in
`docs/contracts.md` are sufficient. If you believe otherwise, schema protocol.

## Requirements

1. **Closet page** at `/closet`: items in the derived UI groups (contracts.md
   table), design C's layout; rows show brand + model where linked, category
   noun + `[GENERIC]` where not, and the closet header carries the quiet
   enrichment nudge ("5 of 8 pieces are still generic") when applicable
   (D-27/D-28) — filter rail (desktop) / filter sheet (mobile):
   category group, works-at temp range (from est or verdict-derived range),
   conditions flags, performance (most dialed / never worked / untested /
   retire candidates — computed from entry + verdict data via the feed
   module's public read API **if merged; otherwise from entries tables via
   your own queries, noted in the design doc**). Retired items behind a
   toggle. Empty state copy from docs/product.md.
2. **Garment detail** (panel on desktop, page on mobile): photo, attributes,
   temp band (est range labeled `[UNTESTED]` until verdicts exist; verdict
   history summary once they do), mileage, "pairs with" (co-occurrence in
   entries, top 2).
3. **Add/edit (screen F, v1 — identity-first, D-27)**: the form leads with
   "What is it?" — brand (autocomplete against `brands`, create-if-missing)
   - model name; picking/creating both resolves a `products` row
     (create-if-missing on normalized brand+name, D-30) and links
     `product_id`. Category one tap; attribute fields (per the discriminated
     union) collapsed below, pre-filled from product attributes where the
     product has them (garment columns override). Generic entry (category
     only) still possible, just not the path of least resistance. Estimated
     range shown when attributes support it (thermal defaults table in `lib/`,
     hand-built, per category × weight × wind; product `fabric_composition`
     noted for the call epic, unused by the v1 table). Product URL https-only,
     zod-validated; on paste, call `enrichment.requestEnrichment(productId,
url)` **if lane 107 has merged; otherwise leave the documented TODO
     call-site** — saving never waits on it.
     3b. **Brands + products module**: seed the curated running-brand list
     (~50 brands) as a migration-seeded table; prefix autocomplete server
     functions for brands and products (products scoped `status='active'`);
     normalization util (casefold, punctuation/whitespace fold) in `lib/`.
4. **Tap-list data**: implement the curated per-climate garment starter lists
   (a static table in your module: category defaults keyed by rough climate
   band) + a server function `closet.addFromTapList(items[])` creating
   `origin='taplist'` rows. Lane 105 builds the onboarding UI on top of it.
5. **Photo flow**: multipart upload → validate content type (jpeg/png/webp)
   and size (≤ 10 MB) → generate 3 sizes (thumb 200px, card 600px, full
   1600px) at upload time → store under `items/{userId}/{itemId}/{size}.webp`
   in R2. Serve via cached GET route. Image work must stay within Workers CPU
   limits — document the library choice and CPU cost in your design doc
   (photon-wasm is the likely answer; benchmark one real photo in a test).
6. **Retire, don't delete**: items referenced by any outfit_entry_item can
   only be retired; unreferenced items may be hard-deleted.
7. **Authorization**: every query scoped to the session user. Test proving
   user A cannot read or mutate user B's items.
8. **Degradation** (CLAUDE.md law 5): photo failure fails only the photo —
   the item saves and the form shows a photo-specific retry. R2 originals
   written before derived sizes.
9. **Brand**: measured values through `Mono`/`Bracketed`; lexicon per
   docs/product.md (it's "the closet", never "wardrobe", in copy).

## Out of scope (do not build)

Vision auto-read (call epic), the enrichment pipeline itself (fetching,
extraction, snapshots — lane 107), product merge tooling (post-v1, D-30),
"worn by N" counts (lane 104 computes them from public entries), affiliate
anything, body measurements, kits, sharing/visibility settings beyond the
`visibility` column ('ok' now, so 106 can add states without migration),
onboarding UI (105 owns it).

## Test expectations

- Unit: garment union codec (per-category attribute acceptance/rejection),
  thermal defaults table, retire-vs-delete logic, brand/product
  normalization (dedup collisions land on one row).
- Integration (workers pool): CRUD roundtrip against real D1, R2 photo
  store/retrieve, cross-user authorization denial, tap-list creation,
  product create-if-missing (two users typing the same product share a row).
- Component render test per major component (closet grid, garment form
  renders category-appropriate fields).

## Done criteria

Design doc committed (async review) → implemented → `npm run verify &&
npm test` clean → PR lists routes added and conventions established that
other lanes should copy.
