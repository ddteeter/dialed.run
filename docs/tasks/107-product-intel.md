# Task 107 — Product Intelligence (starts after 101 merges)

## Goal

Every pasted product link becomes durable, deep product data: fetch the page,
snapshot it forever, and extract structured attributes — fabric composition
above all — through a deterministic-first ladder with an LLM rung at the
bottom. Retention-first: links rot, snapshots don't, and extraction re-runs
over snapshots as it improves (D-31). Invisible feature — results appear as
pre-filled, editable product fields, never a screen of its own.

## You own

- `src/modules/enrichment/**`
- The Queue consumer for `dialed-enrichment`
- Tests under `test/enrichment/**`

You consume via index.ts only: `products` (write extracted fields — 101 owns
the module; coordinate the writer function signature in your design doc).
Public API: `enrichment.requestEnrichment(productId, url)` — 101's paste
call-site TODO wires to it when you merge.

## Requirements

1. **Bounded fetch**: https only, block private address space and redirects
   to it, `AbortSignal.timeout(10_000)`, response size cap (2 MB), one fetch
   per job. Bot-blocked or failed fetch → `extraction_status='failed'`,
   structured log, never a user-facing error (law 5 — user-entered fields
   are the floor).
2. **Snapshot before parsing**: raw HTML to R2 under
   `products/{productId}/snapshot-{ts}.html`; `product_snapshots` row.
   Snapshots are permanent (D-31).
3. **Extraction ladder**, best data wins per field, rung recorded:
   - **JSON-LD** `Product` schema (name, brand, image, `material`).
   - **Shopify**: try `<handle>.json` / detect Shopify markup —
     title, vendor, images, `body_html` (fabric composition usually lives
     here; parse composition patterns like "88% polyester" — including
     **multi-part compositions** with labeled sections ("Body: …; Liner: …"),
     which map to `fabricCompositionSchema.parts` (D-34); verbatim always
     preserved).
   - **OG tags**: title + image fallback.
   - **LLM rung**: stripped page text → `ExtractionModel` adapter →
     `extractedProductSchema` (zod-parsed; a malformed model response is a
     retryable failure, not a crash).
4. **Write-back**: typed core columns on `products` (composition, weight,
   fabric, wind/water, category_hint, image), full ladder output into
   `extracted` JSON; primary image copied to R2 (`image_key`). Never
   overwrite a field a human has edited — 101's writer API enforces this;
   your design doc documents the precedence rule you agree on.
5. **Model adapter + eval (D-32)**: implement `ExtractionModel` for GPT-5.6
   Luna (presumptive default), Claude Haiku 4.5, and DeepSeek V4 Flash via
   Workers AI (`@cf/deepseek-ai/deepseek-v4-flash-0731` — on-platform, no
   new vendor, free-tier neurons) behind one interface. The external-API
   implementation should target OpenRouter's OpenAI-compatible endpoint so
   ONE key covers Luna, Haiku, and any future candidate (and widening the
   eval is a model-string change, not a new account). Two requirements on
   any OpenRouter route: pin the underlying provider for open-weight
   models (routing variance means the "same" model can land on different
   quantizations — silent accuracy drift the eval can't see) and verify
   the pinned route supports strict structured outputs. Re-verify current
   pricing and model lineup at design time — this space moved three times
   in summer 2026 alone.
5b. **Prompt hygiene rule (all vendors)**: enrichment prompts contain page
   content and the URL only — never user identifiers, run data, or any
   user-linked context. Public data in, public data out. Design-phase eval: ~20 real product pages
   (fixture snapshots committed, including at least two multi-part garments —
   e.g. two-layer shorts, a lined jacket) hand-labeled for composition/weight/wind/
   water; report per-field accuracy per model in the design doc. Ship the
   winner; keys via `env` (Workers secrets).
6. **Re-run support**: a `reextract(productId)` internal function that runs
   the ladder over the latest stored snapshot without refetching — the
   mechanism that makes model/prompt upgrades retroactive.
7. **Resilience**: consumer idempotent (dedupe on productId + snapshot),
   claim pattern not needed (queue-driven), `max_retries: 3` + DLQ →
   `extraction_status='failed'` + Sentry, cron none. Extraction cost is
   bounded per job (one model call); log token usage.

## Out of scope

Vision/photo capture (call epic), product search/browse UI, price tracking,
affiliate anything, merge tooling (D-30), re-crawling on a schedule (re-runs
are manual/micro-task-triggered in v1).

## Test expectations

- Ladder units per rung with fixture pages: a Shopify page, a JSON-LD page,
  an OG-only page, a garbage page (one real captured fixture each).
- Composition parser: "88% polyester, 12% elastane" variants, and
  multi-part forms ("Body: 100% recycled polyester; Liner: 88% polyester,
  12% spandex") → labeled parts; unlabeled multi-fabric strings degrade to
  a single unlabeled part, verbatim intact.
- SSRF guards: private-IP URL and http:// URL rejected.
- Consumer: happy path, fetch-failure path, malformed-LLM-output path,
  redelivery idempotency (workers pool, stubbed ExtractionModel).
- Human-edit precedence: extracted data never clobbers an edited field.

## Done criteria

Design doc committed **with the eval results table** (this lane's design doc
is worth reading synchronously — flag it). Verify + tests clean. Pasting a
real Shopify product URL locally yields a snapshot in R2 and composition on
the product row within one consumer pass.
