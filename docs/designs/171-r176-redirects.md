# Design: 171 R-176 — a redirect carries a link past the denylist

## Problem

The denylist checks a product link as typed. `bit.ly/x`, or an open
redirect on an allowed shop, saves and shows, and enrichment follows the
3xx to the denied page and reads it. The owner's three steps (R-176, dated
2026-11-03) close it before the launch to friends. JavaScript redirects
stay out of scope by choice.

## Approach

- **Where a link landed is a fact, kept in a new table** `link_landings`
  (`url` PK as typed, `landed_domain` in `domainOf` form, `checked_at`).
  Safety owns it, beside `domain_denylist`. It records the domain a link
  landed on, not a "denied" flag, so the denylist still decides at read
  time: if the landing domain is denied after the read, the link goes too,
  and un-denying the domain brings it back. Written for every read whose
  landing domain differs from the typed one, and only for those.
- **One rule, by link.** `safety.deniedLinksOf(db, urls)` answers which
  links are denied, by their own domain _or_ their landing's, in one read
  of each table. The save's refusal (`isDeniedLink`, primary),
  `allowedLinksOf` and `linkDetailOf` (and through it F's Edit
  `storedLinkErrors`) ask it instead of `deniedDomainsOf`. So a link that
  landed somewhere denied behaves like one denied as typed: absent on E
  and on kit views, the Edit error on F, refused on a re-save.
- **The read that lands on a denied site is discarded** (step 1).
  `fetchAndExtract` asks `deps.landing(typed, finalUrl)` after the fetch
  and before anything is stored. On a hit: no snapshot, no write-back, no
  image. The product's `source_url` is cleared and its status goes back to
  `none`, so the next runner's genuine link can be its source. It is not
  marked `failed`, because the sweep would re-fetch a denied page every
  hour for a day. The check is passed in by `ops/queues.ts`, because
  enrichment importing safety would make an import cycle
  (safety → ops → enrichment).
- **`<meta http-equiv="refresh">` is one more hop** (step 2). After a 200
  (direct or proxied), `fetchProductPage` reads the metas with the page
  tokenizer it already has (`html.ts`) and parses the `content` attribute
  through a zod schema. A target is resolved against the page, counted
  against `MAX_REDIRECTS`, and passed through `assertFetchable` like any
  3xx. A refresh with no URL, or one back to the same page, is not a hop.
- **The seed** (step 3, owner's answer in the turn): 22 shorteners and 9
  redirector hosts, in a data migration `0078_seed_link_shortener_denylist`
  (`INSERT OR IGNORE`, `added_by = 'seed'`), following the 0002 brand
  seed. `amzn.to`, `a.co`, `linktr.ee` and `google.com` are left off on
  purpose.

- **A denied link at F's save lands on its field** (found recording the
  demo). TanStack Start sends a thrown `Error` as its message alone, so
  `DeniedLinkError`'s issues never reached `useFormSubmit`, and on `main`
  every denied link at F's save read as "Our end failed". `lib/field-refusal`
  adds a serialization adapter, beside the auth signals', for an `Error`
  that opts in with `code: "FIELD_REFUSAL"`; both now share
  `lib/wire-error`, which sends exactly what each schema reads.
- **Left for later** (R-180): a kept snapshot is not re-checked on
  `reextract` or a redelivery, and a refused save still resolves its
  product, so enrichment fetches the denied URL once and discards it.

## Contract touches

- Schema: **additive**. The new table `link_landings` (migration 0077),
  then a data seed (0078). Both are additive under `.claude/rules/schema.md`;
  `docs/contracts.md` gains the table. `products.source_url` now means "the
  first pasted URL that was not denied". That is a narrowing; the reviewer
  can veto it.
- New routes, bindings, queues, crons: **none**.
- Screens: none redrawn. E, D, /kit and F's Edit show their existing
  denied state for more links.

## Test plan

- worker `fetch-page`: a meta refresh is followed; relative target; counts
  toward the five-hop limit; refused to http or private space; no URL and
  self-refresh are not hops; a refresh after a proxied page.
- worker `denylist`: `deniedLinksOf` by own domain, by landing, by a
  landing's parent suffix, empty input makes no query; `recordLanding`
  writes only a cross-domain landing, upserts, and answers denied/allowed.
- worker `consume`: a denied landing stores no snapshot, no image, no
  specs, resets the product; an allowed landing records and proceeds.
- worker `garment-link`, closet save: a link denied by its landing is
  absent, has no outcome, and is refused at save.
- worker: the seed migration lands its rows (`deniedLinksOf` on `bit.ly`).
- architecture: `one-link-rule` covers `link_landings` too.

## Open questions

- None blocking. Proceeding on: clearing `source_url` on a denied read
  (above).
