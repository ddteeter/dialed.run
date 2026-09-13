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

## Fetching is the part that cannot be redone — and a plain Worker fetch mostly cannot

Extraction improves retroactively; `reextract` re-runs the ladder over a
stored snapshot. **Fetching does not:** a page never retrieved has no
snapshot, so a fetch failure is permanent where an extraction miss is not.

**Measured 2026-09-13, and it inverts the earlier reading of this section.**
The same 14 product pages, fetched twice:

| from                                                 | 200 | 403 + challenge |
| ---------------------------------------------------- | --- | --------------- |
| a laptop on a residential IP                         | 14  | 0               |
| a Worker on Cloudflare's edge (`deploy --temporary`) | 3   | 11              |

Every Shopify store in the sample — and Brooks — returns a 6 kB Cloudflare
challenge to a Worker while serving a laptop happily. Only Arc'teryx and
Nike let the Worker through, which is the reverse of what brand size would
predict.

So the earlier conclusion, that no fallback was worth buying, was drawn from
the wrong network and is wrong. **A fallback is the primary path, not an
escalation.** And Cloudflare Browser Rendering is specifically the wrong one:
these are Cloudflare-protected sites refusing Cloudflare egress, so the
detection advantage is theirs. Residential or mobile proxy egress is what the
403s call for — Firecrawl's stealth mode is ~4 credits, roughly $3.30 per
1,000.

The alternative is to accept it: the packet already says a bot-blocked fetch
is `extraction_status='failed'` and never a user-facing error, and
user-entered fields stay the floor. That is a working product in which
enrichment succeeds about a fifth of the time. It is the owner's call, and it
is a vendor and cost decision rather than a technical one.

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

## Closed — the Shopify `.json` question, answered twice

**No.** Measured 2026-09-13, and it fails on both axes independently.

It would not carry the data: composition lives in Shopify _metafields_
rendered into the page, and those are not in `/products/{handle}.json`. And
it is not reachable anyway — from a Worker, the `.json` endpoint returns the
same 403 challenge as the page it sits beside, on 9 of 9 stores tested. The
packet's "one fetch per job" stands, on evidence rather than assumption.

## Open — the fetch fallback is a cost decision

A plain Worker fetch is blocked on 11 of 14 pages (above). Residential or
mobile proxy egress is the only thing that answers a 403, and on Firecrawl
that means stealth mode, which is **not** on the free tier — free is 1,000
credits of basic mode, which is the datacenter egress already being refused.

Stealth is 5 credits a page. Hobby is $19/month ($16 annual) for 5,000
credits, so **about 1,000 enriched pastes a month for $19**, with auto-reload
at $5 per 1,000 credits after that.

**Recommendation: build the adapter, do not subscribe yet.** The fallback
goes behind the same shape as the model rung — configured by a key, absent by
default — so enrichment degrades to the deterministic rungs when there is no
key (law 5), and lights up when there is one. That makes the spend a decision
about users rather than a refactor, and Nike and Arc'teryx work without it
either way.
