# Design: 107 Product Intelligence

## Problem

A pasted product link should become durable product data — fabric composition
above all, since that is what the Call will reason about. Links rot, so the page
is snapshotted permanently and extraction re-runs over the snapshot as it
improves. Invisible: results arrive as pre-filled, editable fields, never a screen.

## Approach

`src/modules/enrichment/`, consumed only through its `index.ts`:

- `fetch-page.ts` — https only, private address space blocked **before and after
  redirects**, `AbortSignal.timeout(10_000)`, 2 MB enforced _while streaming_ (a
  cap checked on an already-buffered body is not a cap).
- `snapshot.ts` — HTML to `MEDIA` at `products/{id}/snapshot-{ts}.html`, then the
  `product_snapshots` row. R2 first: nothing spans R2 and D1 (law 8c), and an
  orphaned object is recoverable where a row pointing at no object is not.
- `rungs/{jsonld,shopify,og}.ts` — each a `PageExtractor` from `lib/contracts`.
- `composition.ts` — parser incl. labeled multi-part → `fabricCompositionSchema.parts`;
  `verbatim` always preserved.
- `model/openrouter.ts` — `ExtractionModel` over OpenRouter. Prompts carry page
  content and the URL only (5b).
- `consume.ts` — the consumer, into the existing `ops/queues.ts` stub.

Best data wins **per field**, not per rung: a JSON-LD page with no `material`
still falls through to Shopify's `body_html` for composition alone. The rung
recorded is the highest that contributed.

## Contract touches

- **Schema changes: none.** Phase 0 shipped `product_snapshots` and every
  extraction column on `products`, plus `PageExtractor`, `ExtractionModel`,
  `extractedProductSchema`.
- **New bindings/queues/crons: none.** `ENRICHMENT_QUEUE`, both consumers and
  `MEDIA` are already bound. `OPENROUTER_API_KEY` is a secret, not a binding.
- New routes: none. Screens: none. Design-delta items: none.

## Test plan

- `fetch-page`: rejects `http://`, a private-IP host, and a **redirect** into
  private space; aborts past 10s; stops reading past 2 MB. (unit)
- Each rung against one real captured fixture — Shopify, JSON-LD, OG-only,
  garbage — asserting what it claims and `null` where it has nothing. (unit)
- `composition`: percentage variants; labeled multi-part → parts; unlabeled
  multi-fabric degrades to one unlabeled part, `verbatim` intact. (unit)
- Consumer: happy path; fetch failure → `failed`; malformed model output
  retryable not a crash; redelivery writes no second snapshot. (workers pool)
- Write-back: skips an edited field, skips a **cleared** one, fills a never-set
  one. (workers pool)

## Eval (D-32) — pending `OPENROUTER_API_KEY`

~20 real pages, fixtures committed, ≥2 multi-part garments, hand-labeled for
composition/weight/wind/water; per-field accuracy per model lands here before
anything ships. Confirmed at design time, sharpening the packet's warning:
OpenRouter's structured-output support is per **endpoint**, not per model — the
same model on another provider may downgrade `json_schema` to `json_object` or
treat it as a hint. The eval pins a provider per model and asserts strict mode
is honoured, or it measures the wrong thing.

## Decided

1. **Writer signature** — `applyExtraction(db, productId, extracted, rung)` in
   `modules/products`, owning precedence. Enrichment never writes product
   columns directly. (Owner, 2026-09-13.)
2. **Precedence is derived, not stored.** "Never overwrite a field a human
   edited" needs one bit per field — _has a human set this?_ — and that is
   already implied by data we keep: compare each column against what
   `extracted` last recorded. Differs ⇒ a human changed it ⇒ skip.
   Fill-only-what-is-null cannot do this — a field someone deliberately
   **cleared** looks identical to one never set, and would be refilled. A
   stored `edited_fields` column would be a rival truth that can drift
   (§Derive, don't mirror); an audit log answers a larger question and the bit
   would still be derived from it. The case table and its two accepted limits
   live at `applyExtraction`, where the next reader of the rule is.
3. **Model choice** is the owner's, on the eval table above.
