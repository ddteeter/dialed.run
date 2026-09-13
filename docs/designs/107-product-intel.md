# Design: 107 Product Intelligence

> Runs to ~120 lines rather than the template's ~60. Owner doubled the cap for
> this lane (2026-09-13): the packet requires the eval results table to live
> here, and the doc also carries decisions made _during_ implementation that
> the template did not anticipate. Reasoning is moved to its code site
> wherever there is one — the precedence case table is at `applyExtraction`,
> the fetch-fallback ladder at the top of `fetch-page.ts` — so this stays a
> map rather than the territory.

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
recorded is the **deepest** that contributed — this doc first said highest,
which is the less useful of the two. The column's job is to say whether
re-running would help, and a page whose every field came from JSON-LD has
nothing to gain from a better parser or model; recording `jsonld` because it
supplied a name, on a page whose composition came from a description, hides
the part a later run could improve.

## Contract touches

- **Schema changes: none.** Phase 0 shipped `product_snapshots` and every
  extraction column on `products`, plus `PageExtractor`, `ExtractionModel`,
  `extractedProductSchema`.
- **New bindings/queues/crons: none.** `ENRICHMENT_QUEUE`, both consumers and
  `MEDIA` are already bound. `OPENROUTER_API_KEY` is a secret, not a binding.
- New routes: none. Screens: none. Design-delta items: none.

## Fetching is the part that cannot be redone

Extraction improves retroactively — that is what `reextract` over snapshots is
for. **Fetching does not:** a page never retrieved has no snapshot to re-run, so
a fetch failure is permanent where an extraction miss is not.

v1 is a plain fetch, because a fallback is only worth buying against measured
failure, and the two failure modes want different tools — 403 wants residential
stealth, an empty 200 wants a real browser. The ladder, the costs and why
Cloudflare Browser Rendering is the _wrong_ answer to a Cloudflare-protected
403 are at the top of `fetch-page.ts`, where someone reading a 403 will look.
Fixture capture runs through the real fetch path and records status, whether
composition was present, and whether the response carried `cf-ray`.

## Test plan

- `fetch-page`: http, private-IP, and a **redirect** into private space;
  timeout; the 2 MB cap on a body that lies about its length. (unit)
- Each rung against one real captured fixture — Shopify, JSON-LD, OG-only,
  garbage — asserting what it claims and nothing where it has nothing. (unit)
- `composition`: percentage variants; labelled multi-part → parts; unlabeled
  multi-fabric degrades to one part, `verbatim` intact. (unit)
- Consumer: happy path; fetch failure → `failed`; malformed model output
  retryable; redelivery writes no second snapshot. (workers pool)
- Write-back: skips an edited field, skips a **cleared** one, fills a
  never-set one. (workers pool)

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

## Open — decide on the fixtures, not on reasoning

**Should the Shopify rung fetch `/products/{handle}.json`?** The packet allows
one fetch per job; this would be a second, to the same host. It is better
_extraction_ (structured JSON, what Shopify's own themes consume) but not
better _fetching_ — same origin, same bot protection, so a 403 on the page is
a 403 here. It may also be unnecessary: most themes emit JSON-LD, which rung
one already reads, plus an inline theme blob.

**The description must not be fed to `parseComposition` either way.** It asks
only for a percentage beside words, so "20% off" yields a fibre called `off`.
Telling a composition from a discount in prose is semantic — so the division
is regex on _declared_ fields, model on prose.

The fixture capture settles it: for each page, record where composition
actually lives (JSON-LD `material`, JSON-LD `description`, inline theme JSON,
rendered HTML, or only `.json`). Amend the packet then, with the count.
