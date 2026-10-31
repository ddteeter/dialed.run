# Design: 163 Product links end to end

## Problem

A runner can't attach a product link to a garment, and nothing reads
`wardrobe_items.product_url`. F lost its field in task 122, because AC2b
forbids a field that shows nothing and F2a/F2b were never drawn. Behind
the missing field, three gaps keep enrichment from ever reading a pasted
link. A link with no brand gets no product. An unconfirmed runner gets
none until they confirm (D-113). Worst, `createOrGetProduct` never writes
`source_url` onto an existing product, so `requestEnrichment` skips every
product made before its first link, which today is all of them. And /kit
(#277) reads `domain_denylist` itself, a second copy of safety's rule.

## Approach

Two PRs. **A** has no UI and lands while design works. **B** follows the
imported round (open-queue items 93–98).

- **One rule** (A). `safety.deniedDomainsOf(db, urls)` checks the host and
  every parent suffix in one `IN` read, so denying `evil.com` also denies
  `shop.evil.com` (owner, Q2). `isDeniedDomain` becomes a one-element
  call. The save's refusal reads the primary (D-123). Display reads use
  the request's replica (Q4).
- **One read** (A). `closet/garment-link.ts` `allowedLinksOf(db, rows)`
  passes a link only if it parses, is https and is not denied, checking
  the whole batch at once. Every surface that shows a link calls it.
  `feed/public-kit.ts` drops `deniedDomains`/`allowedLink` after #277
  merges, and an architecture test keeps `domainDenylist` inside `safety`.
- **The link reaches the product** (A, Q1). `createOrGetProduct` fills
  `source_url` where it is NULL. A product whose first link failed keeps
  that link (new deferred row).
- **The outcome is readable** (A). `ItemDetail` carries the allowed link
  and `extraction: none | pending | found | nothing | failed`, from
  `extraction_status` and the ledger's `written`.
- **Screens** (B). F's field (add and edit), F2a/F2b and E, plus
  whatever design rules in for D, the /@handle rotation and O3. A
  polling read only if design wants a late result without a reload.
- **Caching** (Q3): a link change is a content edit, left to the 60 s TTL,
  as design 161 already does for renames and denials. No purge.
- **Export** (Q6) keeps `product_url` as typed. **Privacy policy** (Q5)
  gains: "A link you add to a garment is shown, with its site's name,
  beside that piece on your kits that others can see, including public
  ones."

## Contract touches

- Schema changes needed: **none**. The `source_url` fill matches the
  contract's "first pasted product URL".
- New route files: none planned. New bindings/queues/crons: **none**.
  Enrichment's queue, DLQ and `enrichment-retry` cron are already bound.
- Screens: F, F2a/F2b, E. D, /kit, the /@handle rotation and O3 as design
  rules. Design deltas 93–98.

## Test plan

- worker: `deniedDomainsOf`: empty input makes no query; mixed batch;
  www/case; suffix; unparseable and http not "denied".
- worker: `allowedLinksOf`: denied after save, unparseable, http, null,
  and the denylist read once per batch.
- worker: `createOrGetProduct` fills NULL `source_url`, keeps an existing
  one, and the product goes `pending`; `getProductForDetail` gives one
  outcome per state.
- architecture: nothing but `safety` names `domainDenylist`.
- ui (B): F's link states, F2a/F2b, E; e2e demo spec: paste, see the
  outcome on E, see the link on /kit.

## Open questions

- None for PR A. PR B waits on design items 93–98.
- Deferred rows: R-55 closes when design rules on O3. R-33 is touched
  (F2a must not promise a type) and stays open. R-54 and R-67 are left
  alone, provided design draws no product image.
