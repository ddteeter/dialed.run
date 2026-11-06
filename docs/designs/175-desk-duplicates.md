# Design: 175 Desk Duplicates (110 · D2)

## Problem

D-30 accepts some catalogue dirt: dedup in v1 is normalisation plus
autocomplete steering, with no merge tool. That stays a decision only if
the operator can see how much dirt there is. Task 106 built the query
(`safety/duplicates.ts`) and nothing calls it; the Desk rail lists
Duplicates as unlinked text. This lane builds the read-only page.

## Approach

- **Query** (`safety/duplicates.ts`): `duplicateProducts` also counts
  **pieces** per product: the `wardrobe_items` rows whose `product_id`
  is that product, retired pieces included, because a future merge would
  re-point those too. The count comes from a grouped subquery joined in
  the same statement, still under the existing `limit`. Each candidate's
  variants are sorted by pieces descending (name as tie-break). The first
  variant is the **probable name**. A pure `duplicatesReport(candidates)`
  sorts the groups by pieces affected and totals the header:
  names → probable products · pieces affected.
- **Server fn** `deskDuplicatesQuery` in `safety/functions.ts` (GET,
  `requireAdmin(await verifiedUserId())`, as `deskRunnersQuery` does).
  This file is outside the lane's ownership; the coordinator approved an
  append-only change.
- **Component** `safety/components/DeskDuplicates.tsx`: the heading
  "Duplicates", the bracket count, and the board's intro paragraph
  verbatim. Then a grid of cards, each showing the brand (mono caps),
  `[N PIECES]` in hi-viz, the probable name in bold, and the other
  variants each with its piece count in mono. Product and brand names
  are UGC and render only as React text.
- **Route** `src/routes/desk/duplicates.tsx`, under `/desk`'s operator
  gate, rendered in `DeskShell current="duplicates"`. `DeskShell`'s
  `BUILT` gains `duplicates: "/desk/duplicates"`, so the rail entry
  becomes a link. Its place in the rail follows D-87, which is already
  built.

## Contract touches

- Schema changes: **none**. Bindings/queues/crons: **none**.
- New route: `src/routes/desk/duplicates.tsx` (route tree regenerated).
- Screen: Operator Screens **D2 · Duplicates**.
- Empty state (none drawn): owner's words, 2026-11-05. The zeroed bracket
  count stays, followed by the muted line _"No near-misses. Every product
  name under each brand is distinct."_
- **Not built: the rail count.** Round 30's rail draws a muted "23" beside
  Duplicates. The owner deferred it on 2026-11-05: it would run the
  catalogue scan on every Desk page load, through `ops/desk.ts`.

## Test plan

- worker `test/safety/duplicates.test.ts`: piece counts per variant;
  retired pieces counted; a product with no pieces counts 0; variants
  ordered by pieces with a name tie-break; another product's pieces
  never leak in.
- worker: `duplicatesReport` sorts groups by pieces and totals names,
  products and pieces (including the empty report).
- worker: `deskDuplicatesQuery` refuses a non-operator (the existing
  admin-gate pattern for Desk server fns).
- ui `DeskDuplicates.dom.test.tsx`: the header count, the probable name
  bold and first, the per-variant counts, the empty line, and a name
  containing markup rendered as text.
- ui `DeskShell` test: Duplicates is a link to `/desk/duplicates`, with
  `aria-current` when current.
- e2e: an operator opens Duplicates from the rail and sees a seeded
  group. This is the demo spec.

## Open questions

- "Pieces" counts every closet's rows, retired ones included. The page is
  operator-only and shows counts, never whose pieces they are.
- `duplicateProducts`'s 500-product limit can truncate the report once
  the catalogue grows. No count is shown for that case yet; the PR
  records it as a deferral.
