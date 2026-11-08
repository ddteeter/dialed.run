# Design: 187 No shop images, and request access as the public way in

> Wave 4, lane shop-images. Two PRs: #472 alone, then #367 with #366.

## Problem

The owner ruled no shop images (D-176, #472): runners' own photos only. The
enrichment consumer still copies a shop's primary image into R2 and writes
`products.image_key`, so that has to stop and the stored copies go. Public
stays invite-only (D-173), so request access is the only public way in:
the marketing site needs `POST /api/access-requests` (round 31, #367), and
`/` should lead with it (Round 50 · 151a, #366).

## Approach

**PR 1, #472.**

- Delete `modules/enrichment/image.ts` and `copyImageOnce` in `consume.ts`.
  Nothing else writes `products.image_key`, and nothing reads it (no
  surface, no export, `photoResponse` serves entry keys only). The column
  stays for squash (#506) to drop. `contracts.md` marks it unwritten.
- The ladder still extracts `imageUrl` into the `extracted` ledger. It's a
  URL in the raw-extras record (D-31), never fetched or shown. Taking it out
  of `extractedProductSchema` is a contract change for no gain, so it stays.
- `scripts/delete-shop-images.ts`, `npm run shop-images:delete`: a one-shot
  script that is **dry-run by default** and prints every key it would delete.
  `--apply` deletes. `--remote` aims it at the real `dialed-media` bucket
  through `getPlatformProxy` with a remote MEDIA binding (the operator's
  wrangler login, no token), and without it the script runs on local
  Miniflare state. It matches `products/<id>/image-<digits>` exactly,
  because page snapshots share the `products/<id>/` prefix. The selection
  and paging logic is `scripts/shop-images/purge.ts`, which takes an
  `R2Bucket` and is tested against the worker pool's MEDIA. Nothing is
  deployed, so it runs once at the first deploy if anything is there
  (a row in the deployment checklist is deploy-guards' file, so I'll ask
  coordinator-4).

**PR 2, #367 + #366.**

- `src/routes/api/access-requests.ts` POST → `receiveAccessRequest` in
  `modules/account/access-endpoint.ts` (route is glue). It parses the form
  body with zod (`requestAccessSchema` plus `cf-turnstile-response`) and
  calls `requestAccess` on the primary with `blockedRegionOf(request)`, the
  deployment's rate-limit posture and `verifyTurnstileToken`. Results map to
  303s: `received` → `https://dialed.run/invite/sent`; `refused` →
  `/invite?error=turnstile`; `limited` → `rate_limited`; a parse failure →
  `invalid_email`. The same-answer rule holds because `requestAccess` gives
  one receipt for new, repeat and registered addresses.
- **Turnstile's hostname is the marketing host.** The challenge is solved
  on `dialed.run` and posted to `app.dialed.run`, so the attempt names
  `dialed.run`, not the request's host. `verifyTurnstile`'s wrong-hostname
  check stays as it is.
- `lib/marketing.ts` holds `MARKETING_ORIGIN`. `PublicFrame` already has a
  private copy, and it switches to this one.
- `Landing.tsx`, signed out: an ink pill "Request access" →
  `/account/request-access`, then "Have an account? Log in" at every width.
  Signed in: "Your closet", unchanged. The bar is unchanged.

## Contract touches

- Schema: **none** (`image_key` is kept, and squash drops it).
- Routes: `src/routes/api/access-requests.ts` (new, coordinator-assigned).
- Bindings/secrets: **none**. `TURNSTILE_SECRET_KEY` exists. Adding
  `dialed.run` to the site key's hostnames is a dashboard step (round 31).
- Screens: landing `/` (151a). Endpoint: round 31's app-side task.

## Test plan

- vitest worker: `consume.test.ts`, where a page that declares an image
  leaves `image_key` null and puts nothing under `products/<id>/image-`.
  `test/scripts/shop-images-purge.test.ts` covers that dry run deletes
  nothing and lists only image keys, that snapshots survive `--apply`, and
  that paging works past one list page.
- vitest worker: `access-endpoint.test.ts` covers each 303, the marketing
  hostname reaching the verifier, the region passed through, and a
  non-form body. Plus a verification-class row (`sessionless`).
- vitest ui: `Landing.dom.test.tsx` covers both states' links and names.
- e2e: the landing's transcript changes. A Playwright `request.post` covers
  the endpoint on the real Worker with the test Turnstile key, and the
  request shows up in D7. This needs e2e because it's a raw route through
  the real handler.

## Issues

- Closes #472 (PR 1), #367 and #366 (PR 2).
- Opens: Au5 → `dialed.run/invite` once the marketing site is live
  (round 31), and the checklist row for the purge script if coordinator-4
  routes it elsewhere.

## Open questions (building on these guesses)

- A blocked-region request (`isFromBlockedRegion`) gets the same
  `/invite/sent`. Round 31 has no error code for it, and the waitlist copy
  is the marketing site's to show. (Design)
- A note over the cap answers `invalid_email`, round 31's only field
  error, because M5 draws email alone. (Design)
- "Have an account? Log in" shows at every width, even though the bar
  repeats Log in from 720 up. (Design)
