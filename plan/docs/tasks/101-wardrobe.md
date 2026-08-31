# Task 101 — Wardrobe (parallel lane)

## Goal

Runners build their running wardrobe: CRUD for apparel items organized by
body part, with an optional photo per item stored in R2.

## You own

- `src/modules/wardrobe/**`
- `src/routes/manifest/wardrobe.ts`
- Tests under `test/wardrobe/**`

You consume (read-only): `db` schema as-is, `ui`, `lib`, `env`, auth session
middleware. **No schema changes are expected for this lane** — the tables in
`docs/contracts.md` are sufficient. If you believe otherwise, schema protocol.

## Requirements

1. **List page** at `routes.wardrobe.list()`: items grouped by body part in
   the order defined in `contracts.ts` (`bodyParts`). Retired items behind a
   toggle. Empty state that teaches the product ("add your first item").
2. **Create/edit**: brand, name, size, color, body part (required); product
   URL (optional, zod-validated as https URL); photo (optional).
   htmx form → fragment update, no full page reload.
3. **Photo flow**: multipart upload to the Worker → validate content type
   (jpeg/png/webp) and size (≤ 10 MB) → generate 3 sizes (thumb 200px,
   card 600px, full 1600px) at upload time → store all under
   `items/{userId}/{itemId}/{size}.webp` in R2. Serve via cached GET route.
   Image work must stay within Workers CPU limits — document the library
   choice and its CPU cost in your design doc (photon-wasm is the likely
   answer; benchmark one real photo in a test).
4. **Retire, don't delete**: items referenced by any outfit_entry_item can
   only be retired (`retired=1`); unreferenced items may be hard-deleted.
5. **Authorization**: every query scoped to the session user. Write a test
   proving user A cannot read or mutate user B's items.
6. **Degradation** (CLAUDE.md law 5): photo processing failure fails only
   the photo — the item saves without one and the form shows a photo-specific
   error inviting re-upload. R2 originals are written before derived sizes,
   so a mid-processing crash is recoverable by re-deriving from the original.

## Out of scope (do not build)

Affiliate anything, auto-discovery of product photos, body measurements,
item recommendations, sharing/visibility settings. Photo *moderation* is
Task 105 (sequential, later) — but store photos with a `visibility` column
(`'ok'` for now) so 105 can add states without a migration.

## Test expectations

- Unit: zod schemas, retire-vs-delete decision logic.
- Integration (workers pool): CRUD roundtrip against real D1 (miniflare),
  R2 photo store/retrieve, cross-user authorization denial.
- One fragment render test per fragment (returns parseable HTML containing
  expected data; no snapshot tests).

## Done criteria

Design doc reviewed → implemented → `npm run verify && npm test` clean →
PR description lists routes added and any conventions you established that
other lanes should copy.
