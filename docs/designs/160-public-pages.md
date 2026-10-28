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
- worker: each retraction path emits the entry's and runner's tags.
- worker: public loaders' output never contains start time, coordinates,
  flags or notes (schema-level pick, tested against a fully populated row).
- architecture: signed-out loaders import only `worldVisibleEntry`.
- worker: the not-public response is byte-identical for every reason, and
  never contains the handle.
- worker: turning the public profile off while PUBLIC is the default moves
  the default to SHARED and leaves public kits public.
- e2e: publish a kit, open it signed out, retract it, see it 404 after purge.

## Open questions

- Workers Caching is new: check plan availability and whether a cache hit
  skips the Worker (the cost saving) before phase 2. If it is unavailable,
  ship uncached and measure; the Cache API is per data centre and purges
  only locally, so it is not a substitute.
- Purges are rate-limited (Workers Caching uses the Free tier's limits). A
  burst of retractions (a ban across many kits) sends one purge with the
  runner's tag, not one per kit; the TTL covers any purge that is refused.
