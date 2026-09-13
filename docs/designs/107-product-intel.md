# Design: 107 Product Intelligence

> ~150 lines against the template's 60. The owner doubled the cap for this
> lane (2026-09-13); this is over even that, and the overage is the two
> measurements that changed the design — where a Worker gets blocked, and
> where composition actually lives. Reasoning lives at its code site wherever
> there is one (the precedence table at `applyExtraction`, the fetch-fallback
> ladder atop `fetch-page.ts`), and the commits carry it in full, so this
> stays a map. Trimmed four times; say the word and it loses the tables.

## Problem

A pasted product link should become durable product data — fabric composition
above all, since that is what the Call reasons about. Links rot, so the page
is snapshotted permanently and extraction re-runs over the snapshot as it
improves. Invisible: results arrive as pre-filled, editable fields.

## Approach

`src/modules/enrichment/`, consumed only through its `index.ts`:

- `fetch-page.ts` — https only, private address space blocked before and after
  redirects, 10s, 2 MB enforced while streaming.
- `snapshot.ts` — HTML to `MEDIA` before parsing, then the row. R2 first:
  nothing spans R2 and D1 (law 8c), and an orphaned object is recoverable
  where a row pointing at no object is not.
- `html.ts` — script payloads, sliced to `</script>` rather than captured.
- `rungs/{jsonld,shopify,og}.ts` — each a `PageExtractor`.
- `composition.ts` — the fibre-gated composition pass (below).
- `ladder.ts` — runs the rungs best-first, best answer **per field**.
- `model/openrouter.ts` — the LLM rung. `consume.ts` — the queue consumer.

## Contract touches

- **Schema: none so far.** Phase 0 shipped `product_snapshots` and every
  extraction column. A `fibre_candidates` table lands with the model rung —
  additive, so it proceeds under the protocol.
- **Bindings/queues/crons: none.** `ENRICHMENT_QUEUE`, both consumers and
  `MEDIA` are already bound. `OPENROUTER_API_KEY` is a secret, not a binding.
- `PageExtractor.extract` returns `| undefined`, not `| null`: the Phase 0
  signature could not be implemented under `unicorn/no-null`.
- New routes: none. Screens: none. Design-delta items: none.

## Fetching is the part that cannot be redone

Extraction improves retroactively — `reextract` re-runs the ladder over a
stored snapshot. Fetching does not: a page never retrieved has no snapshot.

**Measured 2026-09-13.** The same 14 product pages, twice:

| from                          | 200 | 403 + challenge |
| ----------------------------- | --- | --------------- |
| a laptop, residential IP      | 14  | 0               |
| a Worker on Cloudflare's edge | 3   | 11              |

Every Shopify store in the sample, plus Brooks, refuses a Worker while
serving a laptop. Only Arc'teryx and Nike let it through. So a fallback is the
**primary path**, not an escalation — and Cloudflare Browser Rendering is
specifically the wrong one, since these are Cloudflare-protected sites
refusing Cloudflare egress. Residential or mobile proxy egress is what a 403
calls for. The full ladder and its costs are at the top of `fetch-page.ts`.

## Closed — the Shopify `.json` question

**No**, and it fails on both axes independently. It would not carry the data:
composition lives in Shopify _metafields_ rendered into the page, which are
not in `/products/{handle}.json`. And from a Worker it is not reachable —
same 403 as the page beside it, 9 of 9 stores.

## Composition is found by fibre, not by cue — and the vocabulary learns

The ladder found composition on **0 of 14** real pages while the text was
present in 12. It is not in `body_html`, the only place the Shopify rung
looked; it is in metafields, description divs, `<meta name="description">`
and JSON-LD.

So composition is its own pass over the page's **text nodes** — the right
granularity, because a composition is written as one: `47% 17.5μ merino wool,
38% 37.5® nylon, 15% nylon` arrives whole.

**The discriminator is a known fibre, not a cue word.** Cues fail on real
phrasing (`composition :`, `PacerWeave™ body:`, a `<strong>` fabric name, or
nothing). A fibre word separates a fact from a discount, and the noise is
real — the Janji page carries six `% off` strings against three genuine fibre
percentages. `parseComposition` therefore requires a percentage **and** a
known fibre, which retires its worst failure: "Made with 100% care in
Portugal" no longer yields a fibre.

**A fixed list would rot, so it learns.** Proprietary names are mostly _part
labels_ (`PacerWeave™ body`), which is harmless. The real gap is a
proprietary _fibre_ (`100% Primeflex`), which no list will have. So when the
model rung returns a composition, unrecognised fibres are recorded as
candidates with their snapshot; a human promotes real ones by editing
`fibres.ts` — deliberately a code change, so the vocabulary stays reviewed —
and every promotion improves every stored snapshot on the next `reextract`.
The model teaches the deterministic path instead of being a permanent
dependency, and the share of pages resolved without a model call becomes a
number that should climb.

## Test plan

- `fetch-page`: http, private-IP, and a **redirect** into private space;
  timeout; the 2 MB cap on a body that lies about its length. (unit)
- Each rung against a captured fixture, asserting what it claims and nothing
  where it has nothing. (unit)
- `composition`: percentage variants; labelled multi-part → parts; a discount
  percentage yields no fibre; `verbatim` intact. (unit)
- Consumer: happy path; fetch failure → `failed`; malformed model output
  retryable; redelivery writes no second snapshot. (workers pool)
- Write-back: skips an edited field, skips a **cleared** one, fills a
  never-set one. (workers pool)

## Eval (D-32) — pending `OPENROUTER_API_KEY`

~20 real pages, fixtures committed as **fragments** rather than whole pages —
the repo is public and these are copyrighted marketing pages, and a rung only
needs the fragment. A manifest carries URL, fetch date and SHA-256 so they
stay reproducible.

Per-field accuracy per model lands here before anything ships. Confirmed at
design time: OpenRouter's structured-output support is per **endpoint**, not
per model, so the eval pins a provider per model and asserts strict mode is
honoured, or it measures routing luck.

## Decided

1. **Writer signature** — `applyExtraction(db, productId, extracted, rung)` in
   `modules/products`, owning precedence. (Owner, 2026-09-13.)
2. **Precedence is derived, not stored.** "Never overwrite a field a human
   edited" needs one bit per field, and comparing each column against what
   `extracted` last recorded answers it. Fill-only-what-is-null cannot: a
   deliberately **cleared** field looks identical to one never set. Case table
   at `applyExtraction`.
3. **The recorded rung is the deepest that contributed**, not the highest —
   the column's job is to say whether re-running would help.
4. **Model choice** is the owner's, on the eval table above.

## Closed — the fetch fallback, and it is cheaper than the estimate

**Measured 2026-09-13, free tier.** All eight blocked pages through
Firecrawl's `/v2/scrape` with `proxy: "auto"`:

| result | count |
| ------ | ----- |
| 200    | 8     |
| 403    | 0     |

Every one came back on the **basic** proxy — `auto` never had to escalate —
at **1 credit each**, confirmed against the team credit balance before and
after (1023 → 1015). The enhanced tier is not gated either: an explicit
`proxy: "stealth"` on the same free key returned 200 and also billed 1.

So the estimate in the previous version of this section was pessimistic in
both directions. It is not 5 credits a page, it is 1; and enhanced is
available, not a plan upsell. The cheapest paid plan's 5,000 credits is
~5,000 enriched pastes a month, not 1,000. Pay-as-you-go still tops up only
_within_ a paid plan — there is no bucket without a subscription — and the
free tier's 1,000/month is itself real headroom before launch.

The adapter is still built unconfigured by default, degrading to the
deterministic rungs when no key is set (law 5), so the spend is a decision
about users rather than a refactor.

## What a full page taught that a fixture could not

The fixtures are trimmed fragments. Running the ladder over the eight
**whole** pages Firecrawl returned found two things the fragments hid:

- **A tag can be longer than any bound.** `findComposition` split text nodes
  on `<[^>]{0,2000}>`, so a tag over the bound was not recognised as a tag
  and its attributes arrived as prose. Every one of the eight pages has such
  a tag — 9,810 characters at the shortest, 119,410 at the longest — because
  a Shopify theme renders the whole product JSON into `data-product`. On the
  rabbit page that blob parsed first, so `verbatim` was ten kilobytes of
  markup and the parts were two fabrics listed twice; the other seven hid it
  because a real node happened to win. Now an index walk (`textNodes`), for
  the same reason `withoutCode` is one.
- **2 MB was too small a cap.** The pages run 619 kB to 2,450 kB and two are
  over 2 MB, so `MAX_BYTES` was dropping a quarter of the sample before
  extraction ever ran. Raised to 6 MB, which is a guard against an endless
  stream rather than a budget.

With both fixed, composition extracts from **7 of 8** whole pages, and the
rabbit page's `verbatim` is now `PacerWeaveTM body: 91% recycled polyester &
9% spandex` rather than ten kilobytes of markup.

The miss is the SOAR shorts page, and it is not an extraction failure: the
delivered HTML states no composition. Its only fibre words are product names
in a recommendations payload ("Merino Beanie", "Merino & Silk Base Layer"),
so there is nothing for any parser to find. That is the shape a **200 with
the content missing** takes — the case the `fetch-page.ts` header reserves
for Browser Rendering, now with one measured instance behind it.
