# Design: 160 Public pages — build and scale

## Problem

`docs/proposals/160-public-pages.md` lets a runner put a kit and their
profile on the open web. A public page can be linked from a thread that
spikes, so it has to survive a burst of anonymous traffic. It also has to
come down promptly when its runner, the Desk or a classifier takes it back.
Those two needs pull against each other: the faster a page is cached, the
slower it is to retract.

## Approach

**Rendered on request, cached at the edge for a minute. No static build.**
A static or eventually consistent build (render to R2 on write, serve the
files) was considered and rejected:

- Every write a public page reads would have to trigger a re-render: audience,
  verdict, caption, moderation, ban, leaving, handle, product rename. A missed
  trigger is not a stale page but a **retracted kit still public**, with no
  bound on how long. Eventual consistency is the wrong property for unpublish.
- The load does not need it. A Worker render plus a D1 read (a replica,
  design 143) is milliseconds. A front-page thread is on the order of 100
  requests a second, and the cache below absorbs nearly all of them.

**Public URLs never vary by viewer** (proposal decision 6). `/k/<entryId>`
and `/@handle`, on the app host (D-99), render the anonymous view for
everyone. For a signed-in viewer, the page swaps the top bar's Log in for
"Open in the app" and drops the invite block **client-side, after load**
(round 41 #86c); the HTML has no per-viewer content. That makes them safe
to cache by construction: no cache key on cookies, no chance of serving one
runner's view to another.

**"Not public" is one response** (round 41 #86f): identical bytes, status,
headers and card whatever the reason (never public, retracted, removed,
held, deleted, banned, never existed), so a stranger cannot tell a private
kit from a missing one. It is cached and tagged like a public page, so a kit
made public replaces it within the TTL.

**Workers Caching** (`"cache"` in `wrangler.jsonc`, owner-made) serves
public responses with `Cache-Control: public, max-age=60` and a `Cache-Tag`
per entry, runner and product. **The 60-second TTL is the guarantee**:
whatever is missed, a retracted page is gone within a minute. Purges are
only an accelerator for retractions (audience off `world`, hide, takedown,
ban, leaving, deletion, profile switch off): one `cache.purge({ tags })`
from the writer, in `waitUntil`, never failing the write (law 5). Every
other route keeps today's `private` headers.

**One visibility rule for the open web**, beside D-58's in
`modules/safety/visibility.ts`: `worldVisibleEntry()` = `audience = 'world'`
and the same moderation, ban and leaving clauses, with no viewer. The
signed-in stranger rule widens to `audience IN ('runners', 'world')`, so
consensus, feeds and "worn by N" count world kits as shared. An
architecture test pins that signed-out loaders read only through
`worldVisibleEntry()`.

**The card** revives `ops/og/cards.tsx`'s entry card (R-150) with the
Visual Crossing credit (R-160). Its URL carries the entry's version, so an
edit makes a new card and the old one is never referenced again. Cached a
day; it carries no photo or caption (D-51, round 41 #86e), and once a kit
is not public its image URL serves the default card. The public profile
keeps the default card.

**Photos** (phase 4) follow R-153: copy to a public bucket on world publish,
delete and purge on retraction.

## Contract touches

- Schema changes needed: `user_profiles.public_profile` and
  `user_profiles.public_closet` (int 0/1, default 0) — **HARD STOP for
  review**. `world` needs no migration: `audience` is text with no CHECK
  (design 131); `writableAudienceSchema` widens to admit it.
- New routes: `src/routes/k/$entryId.tsx`, `src/routes/og/k.$entryId.ts`;
  `@{$handle}.tsx` becomes the public profile and H moves to
  `/feed/u/$handle`.
- New bindings: Workers Caching config (phase 2), public R2 bucket and
  custom domain (phase 4) — **HARD STOP, owner-made**.
- Screens: round 41 #86 (`Round 41 Rulings.dc.html`): A3's audience
  radiogroup, D's owner meta, Settings › Privacy's PUBLIC PROFILE group,
  `/k`, `/@handle`, the card and the not-public page; H's empty state and
  the legal strings change with it.

## Test plan

- worker: `worldVisibleEntry` excludes every non-world audience and every
  moderation, ban and leaving state; the stranger rule admits world.
- worker: each retraction path emits the entry's and runner's tags
  (`test/safety/edge-purges.test.ts`).
- worker: public loaders' output never contains start time, coordinates,
  flags or notes (schema-level pick, tested against a fully populated row).
- architecture: signed-out loaders import only `worldVisibleEntry`.
- worker: the not-public response is byte-identical for every reason, and
  never contains the handle.
- worker: turning the public profile off while PUBLIC is the default moves
  the default to SHARED and leaves public kits public.
- e2e: publish a kit, open it signed out, retract it, see it 404 after purge.

## Open questions

- **Workers Caching, checked 2026-10-28** (Cloudflare's Workers Cache
  docs; wrangler 4.151's config schema; workerd 1.20261012 under vitest).
  Turned on in `wrangler.jsonc` (`"cache": { "enabled": true }`, owner,
  2026-10-28). Verified from the docs: a hit is served from the edge
  without running the Worker (no CPU billed; the request still is); there
  is no separate price; the key is the path and query string (`?all=true`
  is its own entry), not the host and not `Cookie`; `Set-Cookie` on a
  response and `Authorization` on a request bypass it; it is partitioned
  by Worker version unless `cross_version_cache` is set (it is not, so a
  deploy starts cold); a purge reaches only the entrypoint that calls it
  (ours all run in the default export) and propagates globally like a
  zone purge; zone purges never reach it. **Not verified**: plan
  availability (the docs name no plan; deploy will say), and whether the
  scheduled and queue handlers count as the same entrypoint as `fetch`
  for a purge (the docs imply it and do not say so; the account deletion
  purge and the report sweep purge from there). Locally there is no
  `purge`: workerd exports `cache` without one, even with `cache.enabled`
  in the test pool's config, so the purge degrades to nothing there.
- **Purges are rate-limited at the Free tier's limits whatever the plan:
  5 calls a minute, a bucket of 25, 100 operations a call.** So one call
  per retraction carrying all its tags, a ban or a leaving names the
  runner and not each kit, and a refused purge is reported and left to
  the TTL. Every writer below can be driven by a signed-in runner (an
  audience toggle, a profile switch), so a runner could spend the bucket;
  the TTL is still the guarantee, and a refusal in Sentry is how we would
  see it happening.
- **Heuristic freshness**: with caching on, Cloudflare applies RFC 9111
  heuristic freshness to a response that has no `Cache-Control`, and
  `Cookie` is not in the key. Settled in this PR: every response that is
  not public now leaves with `Cache-Control: private, no-store` unless it
  names its own (`withSecurityHeaders`, "Deviations (CSP)"), so a page that
  varies by viewer is never stored.

## Deviations (purge)

- **The tags moved to `lib/cache-tags.ts`**, with `PurgeTags`: the writers
  that take a page back live in `safety` and `onboarding` too, which `ops`
  imports, so they could not import the tags from `ops`. Those writers take
  the purge as a parameter, wired by their server functions and the cron
  (`ops/edge-purge.ts`'s `purgePublicPages`); `feed` and `account` default
  to it.
- **Why the runner's tag is enough for a retraction, and the entry's still
  rides along.** A public `/k` page carries `entry:` and `runner:`, the
  public profile `handle:` and `runner:`, and every not-public page only
  its path's tag. A retraction turns a public page into the not-public one,
  so purging `runner:` alone would clear it; `entry:` is named as well
  because it costs nothing in the same call and also clears a not-public
  page cached at a kit's path when the kit becomes public.
- **The card leaves with the page's minute, not a day.** The card is still
  rendered once a day per version (the Cache API, behind the Worker), but
  its response said `max-age=86400`, and Workers Caching keeps that in
  front of the Worker: a retracted kit's card would have stayed up a day
  whenever its purge was refused. It now says 60 seconds like the page.

What purges, and with which tags (one call each):

| Path                                                                             | Tags                              | Where                                  |
| -------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------- |
| Verdict save that changes or keeps PUBLIC (to, from, or an edit of a PUBLIC kit) | `entry:<id>`, `runner:<owner>`    | `feed/entries.ts` `submitVerdict`      |
| A runner deletes a kit, or the run it is on                                      | `entry:<id>`, `runner:<owner>`    | `feed/retract.ts`                      |
| Account deletion's purge (all runs and kits)                                     | `runner:<owner>`                  | `feed/retract.ts` `deleteRuns("all")`  |
| The Desk removes, quarantines or holds (copyright) a kit                         | `entry:<id>`, `runner:<owner>`    | `feed/moderation.ts` `moderateContent` |
| A report hides a kit (at once, at the threshold, or by the sweep)                | `entry:<id>`, `runner:<owner>`    | `safety/reports.ts`                    |
| A removal request holds a kit (filed or confirmed)                               | `entry:<id>`, `runner:<owner>`    | `safety/takedown-requests.ts`          |
| Ban                                                                              | `runner:<id>`                     | `safety/bans.ts` `banUser`             |
| Leaving (deletion scheduled)                                                     | `runner:<id>`                     | `account/deletion.ts`                  |
| Handle claimed or changed by the runner, or renamed by the Desk                  | `runner:<id>`, `handle:<new>`     | `account/username.ts`                  |
| Public profile or Show my closet switched, either way                            | `runner:<id>`, `handle:<current>` | `onboarding/public-profile.ts`         |

Left to the TTL, on purpose:

- **Publications other than the two switches above**: unban, Keep my
  account, a review's Approve, a copyright hold restored, a request given
  back, a first-time email confirmation, a new kit saved PUBLIC (no page
  could be cached at a path nobody had). The not-public page gives way
  within a minute; nothing private is shown meanwhile, and each would
  spend a purge from the bucket the retractions need.
- **The old handle on a handle change.** Its path's public page carries
  `runner:`, which is purged; its not-public page is the same bytes before
  and after.
- **Photos**: no photo is on the open web until world photos (step 8,
  D-151), so a photo's removal, hold or hide purges nothing. Step 8 adds
  the photo's own purge.
- **Content edits that are not a retraction**: a run's distance or time,
  weather attaching, a garment renamed or retired, a product renamed, a
  domain denied, units or zone changed. What changes is not something the
  runner took back.
- **The copyright hold's 30-day purge and the litigation hold's delete**:
  the kit has been hidden since the hold, so its page is already the
  not-public one.

## Deviations (step 6)

- **"Identical bytes" holds up to two per-render values.** The not-public
  page is the same for every reason, but two renders of any page differ in
  the CSP nonce and the router's load timestamps, which carry nothing about
  the kit. The edge keeps one render and serves it to everyone; the worker
  test compares the read and headers, the DOM test the first paint.
- **The root reads no session on an open-web path** (`lib/open-web.ts`): no
  handle gate and a fixed "nobody" for the root loader, so no redirect and
  no per-viewer value is ever written into a page the edge keeps. Links off
  `/k` reload the document so the app's pages read the session again.
- **A public response never sets a cookie** (`withoutCookiesWhenPublic` in
  `server.ts`): the D1 bookmark cookie is dropped rather than stored and
  handed to the next visitor.
- **The day is the run's**: its observation's zone (R-96, as D dates it),
  else the runner's place's zone, else UTC. Feels-like is the hour the
  verdict judged (R-5). A run with no moving time shows its own time,
  labelled TIME rather than MOVING.
- **A piece's kind is the closet's TYPE chip** ("L/S crew", "Tights"),
  else its category's word (round 42 #90, the same rule as `/@handle`):
  `closet`'s `typeWordOf`, read through its index by `feed/public-kit.ts`,
  which nothing in `feed`'s index reaches, so it makes no cycle (as
  `public-profile.ts`'s rotation read does). A product link whose domain
  the denylist now holds is dropped at read, not only refused at save.
- **The bar** (round 42 #90): the bracketed wordmark at every width and
  one slot in pill form, a hairline Log in signed out and an ink "Open in
  the app" signed in, never both. The swap stays client-side after load,
  so the page the edge keeps is the same for everyone.
- **The card's version is a digest of what it shows**, and the Cache API key
  carries it in the path (the card key drops the query string). The default
  card served for a kit that is not public is kept a minute and tagged with
  the kit, like the page, so a kit made public previews within the TTL.
- **Report this kit** prefills `/takedown?location=`, which `/takedown` now
  accepts; `takedownSubjectOf` reads a `/k/<id>` link as the kit.

## Deviations (step 7)

- **H is `/feed/u/<handle>`, and `/feed/u/<userId>` still works**: one
  route takes either; an id (a ULID, which no lowercase handle of at most
  20 characters can be) asks for the runner's current handle and
  redirects, as the old id route did. `/@handle` is no longer an in-app
  push in `nav-types` (it is reached by a document load).
- **The runner gate is `runnerInStanding()`** (`feed/runner-visibility`):
  not banned, not leaving, and a confirmed address, the floor H and search
  already stood on, now shared with the open web. An unconfirmed runner's
  public profile is not public, like a never-held handle. A handle given
  up (`/@old`) is not public either: the open web never says a name
  changed.
- **The rotation is read in `closet`** (`closet/public-rotation.ts`,
  through its index): the type words and the mileage are the closet's, and
  `feed/public-profile.ts` importing `closet`'s index makes no cycle
  because nothing in `feed`'s index reaches it. Shoe mileage is the
  closet's own sum, over every run the shoes were on, private ones
  included: it is what the closet says, and what "Show my closet"
  promises. The owner confirmed it on 2026-10-28: a figure without the
  private runs says nothing about the shoe.
- **"Show {N} more" is `?all=true`, and lists at most 100**: a bound on
  one view's read; the count still says how many there are.
- **Cache tags**: the profile is tagged `handle:<handle>` (normalized,
  lowercase) always, and `runner:<userId>` when public. The not-public page
  carries only the handle's tag, which names the path, not a runner. A
  purge on publish (making a profile public) should name `handle:<handle>`;
  nothing purges yet.
- **The handle is not echoed in the not-public page's HTML**; the
  router's own state carries the URL, as `/k`'s does its id, which is the
  request itself. "Look in the app" is built in the browser, after load.

## Deviations (CSP)

Owner's ruling, 2026-10-28: a page the edge stores cannot carry the
per-request nonce (OPS-8), because the stored copy hands one nonce to
every visitor for as long as it is kept. Public pages use hash-based CSP.

- **No nonce is minted for an open-web path.** `requestContext()`
  (`lib/csp-nonce`) gives `/k/<id>` and `/@handle` (`isOpenWebPath`) the
  context `{ hashedScripts: true }` instead of `{ nonce }`, so the router
  stamps nothing: no `nonce` attribute on any script, `modulepreload`
  link or style, and no `<meta property="csp-nonce">`. `routerSsr` reads
  that context as "none on purpose", and still throws in dev for a
  context with neither.
- **The policy names each inline script's SHA-256 instead**
  (`ops/inline-script-hashes`), read from the buffered body with the
  platform's `HTMLRewriter`: every `<script>` without a `src`, its text
  with CRLF and CR turned into LF as the browser's parser does, distinct
  and in document order. Script files are admitted by `'self'` as before
  (the policy has no `'strict-dynamic'`), so the strength is the same:
  only the scripts the server wrote run inline. Buffering costs the
  stream, which these small pages do not need.
- **Which responses are hashed** (`secureResponse`): any response whose
  `Cache-Control` says `public` (the test `withoutCookiesWhenPublic`
  uses), and any response on an open-web path whatever it turned out to
  be, since a not-found or error page there has no nonce either. A
  public response that is not HTML (the share card) names neither nonce
  nor hash. A public HTML response off the open web would still carry its
  render's nonce in its markup, but its policy names only hashes, so that
  nonce admits nothing; no such route exists. Every other response keeps
  the per-request nonce, unchanged.
- **Two renders of the same public page still differ**, now only in the
  router's dehydrated load times (`u:<ms>` per match), which change the
  hash of that one inline script and so the policy: step 6's first bullet
  loses its nonce half. The edge stores headers and body together, so a
  stored copy's policy always names its own scripts (e2e
  `desk-door.spec.ts` checks both renders, and that nothing else
  differs).
- **Every response that names no `Cache-Control` now leaves with
  `private, no-store`**, set in `withSecurityHeaders` beside the security
  headers; a route's own value (a public page's, a photo's
  `private, max-age=3600`, a closet photo's `private, …, immutable`)
  stands. Not in `public/_headers`, whose static assets should be cached.
  Why: Workers Caching docs
  (<https://developers.cloudflare.com/workers/cache/configuration/>,
  "Cache-Control semantics", read 2026-10-28) say a Worker response with
  no `Cache-Control` or `Expires` is still cached by RFC 9111 heuristic
  freshness with per-status default TTLs — "a `200` response that does not
  set `Cache-Control` is cached for 2 hours", a 404 for 3 minutes,
  300/301 for 20 minutes — and "Omitting `Cache-Control` is not the same
  as opting out of the cache"; "If you want a response not to be cached,
  return `Cache-Control: no-store` (or `private`) explicitly." A response
  with `private` or `no-store`, or one setting a cookie, bypasses
  (`Cf-Cache-Status: BYPASS`). The overview
  (<https://developers.cloudflare.com/workers/cache/>) says the same:
  "Workers Caching follows the semantics defined in RFC 9111, including
  heuristic freshness for responses that do not carry `Cache-Control`."
  So without this, once `"cache": { "enabled": true }` is set, a signed-in
  page with no cookie on its response could be stored for two hours and
  served to the next visitor. The cost: Chromium has kept `no-store` pages
  out of the back/forward cache, so a Back to an app page may re-fetch it.

## Build steps

Each step is one or more commits that pass the commit gate on their own.

1. **Contract** (`lib/contracts/audience.ts`): `world` joins `audiences`
   and `writableAudienceSchema`; `strangerAudiences` (`runners`, `world`)
   replaces `SHARED_AUDIENCE` as what strangers see; files write `public`.
   Done when `test/lib/audience.test.ts` pins every set.
2. **Visibility** (`modules/safety/visibility.ts`, `feed/feed.ts`,
   `safety/photo-matches.ts`): the stranger rule admits `world`;
   `worldVisibleEntry()` is the open-web rule. Done when
   `test/safety/visibility.test.ts` covers every audience in both rules.
3. **Schema**: `0071_add_public_profile_switches` (additive).
4. **Writes**: per-kit PUBLIC, held at PRIVATE for an unconfirmed runner;
   a PUBLIC default only while the profile is public; turning the profile
   off moves a PUBLIC default to SHARED in the same batch.
5. **UI** (round 41 #86a–b): A3's radiogroup, D's owner meta,
   Settings › Privacy's PUBLIC PROFILE group, the changed strings.
6. **`/k/<id>`** (#86c, #86f), its card (#86e) and the cache headers.
7. **`/@handle`** (#86d) and H's move to `/feed/u/<handle>`.
8. **World photos** (D-151), once the owner has made the bucket and domain.
