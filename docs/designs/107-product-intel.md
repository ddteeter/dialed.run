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
  redirects, 10s; direct from the Worker first, then through the proxy on a
  refusal (401/403/429/503 — a 404 is not a refusal and earns no credit).
- `bounds.ts` — the 6 MB cap, enforced while streaming, shared by both doors.
- `firecrawl.ts` — the proxy: `/v2/scrape`, `proxy: "auto"`, the envelope
  zod-parsed and held to the same cap. Unconfigured means unwired.
- `snapshot.ts` — HTML to `MEDIA` before parsing, then the row. R2 first:
  nothing spans R2 and D1 (law 8c), and an orphaned object is recoverable
  where a row pointing at no object is not.
- `html.ts` — script payloads, sliced to `</script>` rather than captured.
- `rungs/{jsonld,shopify,og}.ts` — each a `PageExtractor`.
- `composition.ts` — the fibre-gated composition pass (below).
- `ladder.ts` — runs the rungs best-first, best answer **per field**.
- `request.ts` — `requestEnrichment`: flips the row to `pending`, then sends.
- `consume.ts` — the consumer, its DLQ handler, and `reextract`.
- `model/openrouter.ts` — the LLM rung (not yet).

## Contract touches

- **Schema: one additive table.** Phase 0 shipped `product_snapshots` and
  every extraction column. `fibre_candidates` lands with the model rung —
  a new table, so it proceeds under the protocol; migration
  `0015_fibre_candidates`, numbered past everything on main and in the one
  open PR (law 11).
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

## The model rung, and why the provider is pinned

`model/openrouter.ts` implements `ExtractionModel`. Three things it does
that are not obvious, each measured rather than assumed:

**The provider is pinned and fallbacks are off.** Structured output is a
property of the *endpoint*, not the model — and the endpoint listing proves
it: `openai/gpt-5.6-luna` is served by seven endpoints and the **Amazon
Bedrock** one reports `structured_outputs: false` while OpenAI's and
Azure's report true. Unpinned, a request can be routed to an endpoint that
ignores `response_format` and answers with prose. That is not an error; it
is a successful completion nobody can parse, and it would show up weeks
later as an accuracy drop with no failing request behind it.

**The JSON Schema is derived from the contract** (`model/json-schema.ts`),
because a hand-written copy is a rival truth: a field added to
`extractedProductSchema` and forgotten there is one the model is never asked
for, silently. Two translations sit on top of `z.toJSONSchema`, and both are
the provider's dialect rather than a second schema — strict mode requires
every property in `required`, so "optional" is re-expressed as "required and
nullable", and the nulls are dropped again before the contract parses the
answer.

**`extras` is not asked for.** It converts to `propertyNames`, which OpenAI
refuses outright (measured: `400 invalid_json_schema`), and it is the field
the deterministic rungs keep raw evidence in — a model inventing entries for
it would be writing fiction into the one column kept for provenance.

Verified end to end against the live API, two real pages: on the rabbit
page the model returned all three labelled fabric sections where the
deterministic pass found one. It also showed the prompt needs decoded text —
given `&amp;` it copied `&amp;` into `verbatim`, exactly as instructed — so
`pageTextFor` runs the same entity decode the composition pass does.

## The vocabulary learns, and the loop is closed

The model rung runs **only where the deterministic rungs left the
composition blank** — seven of the eight sampled pages answer without it, so
this fires on the eighth. That is the cost control and the quality control
at once: a shop that publishes its own composition has already answered
better than a model can.

Every material the model names that `fibres.ts` does not recognise becomes a
`fibre_candidates` row, with the snapshot and the composition string it
appeared in. A reviewer needs that context, because it is what separates
`primeflex` (a fibre) from `pacerweave` (a part label). Promotion is a pull
request against `fibres.ts`, and that is the point rather than an
inconvenience: a table the system writes *and* reads its vocabulary from
would learn its own mistakes. Each promotion improves every stored page on
the next `reextract`, so the share of products resolved without a model call
is a number that should climb.

`rung` records `llm` only when the model actually filled a blank. A model
that answered nothing new did not deepen anything, and the column's job is
to say whether re-running would help.

## Eval (D-32) — and the decision it produced

`npm run eval` (`eval/`, not collected by vitest — it costs money, depends
on twenty shops being up, and answers a judgement rather than a pass).
Corpus of 22 pages across 14 brands, chosen for spread rather than size:
Shopify, Salesforce Commerce and hand-rolled storefronts; tops, bottoms,
socks, gloves, headwear and technical outerwear.

**Deterministic against the models' consensus:**

| | pages |
| --- | --- |
| same materials as the consensus | 18 |
| deterministic found **fewer** | 3 |
| deterministic found **more** | 1 |

All three shortfalls are one bug — **the composition split across separate
DOM nodes**, where the pass takes the first node that parses and stops.
`rabbit`'s three labelled sections yield one; On's `Front:`/`Back:` yields
the front. The answer looks complete because it is well-formed.

The single "found more" is Arc'teryx, where the deterministic pass and
`gpt-5.6-luna` both say four and only `qwen3.8-27b` says eight — it counted
`Coreloft™ 80`, `Arato™ 15` and `10D x 20D Ripstop` as materials. Those are
fabric trade names, and they are the clearest evidence in the corpus that a
model will invent fibres out of marketing copy.

### Three readings this eval got wrong before it got them right

Recorded because each was reported as a fact about a model or a corpus and
each was a fault in our own instrumentation.

1. **"The model is not a superset."** It missed three pages —
   `pageTextFor` had never shown them to it. The budget loop `break`ed on
   the first node too large to fit instead of skipping it, and Tracksmith's
   page carries text nodes of 168,000 characters, so it reached the model
   as 2,028 of its 889,578. With the whole page, the model returns every
   composition it was said to have missed.
2. **"Cheap is not the same as usable."** `qwen3.8-flash` scored 9 of 22 and
   was written off; every failure was our own 30-second bound. Given a
   patient timeout it answers 22 of 22. `qwen3.8-27b`'s failures are real
   rate limits.
3. **"Deterministic loses on five pages."** The verdict scored against the
   *best* model rather than the consensus, which rewards over-counting: one
   model read the legal phrase "Exclusive of decoration" as a material and
   that inflated count marked a correct deterministic answer as a failure.

**A fourth is still standing**, and the numbers above are reported knowing
it: material count conflates *finding* a composition with *structuring* it.
On SOAR's shorts `gpt-5.6-luna` returned exactly the right verbatim
(`Shell 88% PA 12% EL`) and no parsed parts, so it scores zero and the page
reads as agreement with a deterministic pass that found nothing at all.
Verbatim is the load-bearing half — it is what `fabric_composition` stores
and what D-31 keeps so a better parser can re-read it — so the next
revision of the report scores it separately.

## Decided — the model is the composition, not a fallback for it

**Owner's call, 2026-09-14**, on the numbers above and the costs below.
This reverses the ladder: the deterministic composition pass is no longer
the source of `fabric_composition`.

**Cost is not the reason.** Measured against the real API: a page is ~4,800
prompt tokens and ~270 completion, which is **$0.00065 per product** on the
pinned endpoint — and enrichment is per *product*, not per paste, because
products are canonical rows and `requestEnrichment` only claims `none` and
`failed`. A thousand products is 65 cents. The Firecrawl fetch that obtains
the page costs about five times as much as the model call that reads it.

**The reasons are that the heuristic cannot close, and that falling back to
it is worse than not answering:**

- The vocabulary gate is unbounded. `Coreloft`, `Arato 15`, `PacerWeave`,
  `rabbitDRY`, `2:09 Mesh`, `Primeflex` — on this corpus every trade name
  happened to sit beside a real fibre (`Toray Primeflex™: 100% polyester`),
  so the gate passed. That is luck. A page reading only `100% Primeflex`
  extracts nothing until a human promotes the word.
- **A fallback that produces wrong answers is worse than no answer.** On
  SOAR's half-tights the deterministic pass does not fail — it succeeds,
  with marketing copy, writing `24% merino wool` into the column as though
  it were the spec. A product with no composition is a state the app
  already renders and a user can correct; a product with a plausible wrong
  one is a new failure mode invented to guard against an outage.
- **Enrichment is eventually consistent already.** It is a queue job behind
  `max_retries` + a DLQ + an hourly sweep. The right answer to an upstream
  being down is to stay `pending` and try later; nobody is waiting on it.

**What stays.** The declared-data rungs — JSON-LD, Shopify's product JSON,
Open Graph — are not heuristics. They read a field a shop published, they
cost nothing, they are instant, and they cannot be plausibly-wrong the way
a prose search can. They agreed with the models on name, brand and image on
essentially every page. Only the *composition text pass* is retired as a
producer.

**A consequence to wire.** If the model is the only source of composition,
a model outage must leave the row **retryable**, not terminal. Today a
dead-lettered job marks `extraction_status='failed'` and the hourly sweep
re-drives only `pending`, so a `failed` product waits for someone to paste
it again. That is right when failure means "this page has no composition"
and wrong when it means "OpenRouter was down", so the sweep also re-drives
`failed` rows past an age.

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
5. **`category_hint` takes only an enum member.** The ladder emits whatever
   the shop wrote ("men's pants/jogger"); the column is documented as the
   garment category enum and the closet reads it as one. A free-text hint
   stays in the ledger's `found`. A keyword mapper (shorts → bottom, tee →
   top) is a later, separate step, and is not in this lane's packet.
6. **A ledger the writer cannot read stops the write.** Malformed JSON or a
   wrong shape in `products.extracted` throws, and the consumer records a
   failed job — because a ledger that cannot be read cannot prove
   precedence, and the alternative is a fresh start over a person's edits.

## The consumer, and why the queue is not a transaction

Nothing spans D1 and a queue (law 8c), so the paste path is reconciliation
with a marker the row already has. `requestEnrichment` flips
`extraction_status` to `pending` **first** — that column is "this product
owes an extraction" — then sends, and a send that fails is reported and
swallowed, because enrichment must never fail the garment save that asked
for it. The `enrichment-retry` cron (`30 * * * *`, its own trigger so a
dropped send costs an hour and not a day) re-dispatches anything `pending`
past a fifteen-minute grace. The flip is also the dedupe: only `none` and
`failed` become `pending`.

The consumer treats **only a `pending` row as work**, and on a redelivery
answers from a snapshot fetched inside the last hour rather than fetching
again — fetching is the step with a bill and a blocklist behind it, so a
retry after a failed write-back must not buy the page twice. A
`PageFetchError` is terminal (`failed`, acked, reported); anything else is
thrown so the queue's retries own it, and the DLQ handler marks the row
when they give up. `reextract` runs the ladder over the latest stored page
with no fetch, and re-records the snapshot's rung.

The primary image is copied to R2 (`image_key`) after the write-back, and
only while the column is null: nobody hand-edits an R2 key, so the ledger
`applyExtraction` needs has nothing to protect here, and the only question
is whether we have already paid for this image. A later run finding a
*different* image does not replace it — D-59, because that needs a rule for
the old object and for anything holding its URL. A failed image fetch never
fails the job: a product whose picture 404s still has a composition.

The paste path is wired: `withResolvedProduct` in lane 101's closet service
calls `enqueueEnrichment` (owner's go-ahead, 2026-09-13), where the
bindings stop so `request.ts` stays importable without them. It cannot
throw — enrichment must not be able to fail the save that asked for it.

**Not yet:** the model rung and its eval, and the `fibre_candidates` table.

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

The proxy is wired (`firecrawl.ts`) and unconfigured by default: with no
`FIRECRAWL_API_KEY` a refusal is recorded as a failed fetch, exactly as
before there was a proxy (law 5). So the spend is a decision about users
rather than a refactor — setting the secret is the whole switch.

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

The miss was the SOAR shorts page, and an earlier version of this section
said it "states no composition" and cited it as a measured instance of
client-rendered content. **That was wrong.** The page states its composition
plainly — `Shell 88% PA 12% EL` — and the eval below found it. Two mistakes
produced the claim: a grep over raw HTML missed text that spans several
nodes, and `fibres.ts` has no abbreviations, so the deterministic pass could
not see a fibre there either. So there is **no** measured instance of the
200-with-nothing-in-it case; `fetch-page.ts` still reserves Browser
Rendering for it, on zero evidence rather than one.
