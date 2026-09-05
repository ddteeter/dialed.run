# Task 104 — Outfit Entries, Feed & Social (parallel lane)

## Goal

The heart of the product: attach an outfit to a run with per-item verdicts,
photos, and a caption; follow other runners; scroll a feed of run+outfit
posts. A run appears in the feed only once it has an outfit entry.

## You own

- `src/modules/feed/**` (outfit entries, follows, likes, feed)
- `src/routes/manifest/feed.ts`
- Tests under `test/feed/**`

You consume via index.ts only: `wardrobe` (item picker data), `runs` (run
lookup + the entry-creation route your notification deep-links to —
coordinate the route name in your design doc), `weather` module's
`WeatherAttribution` fragment.

## Requirements

1. **Create/edit outfit entry** for one of the user's runs: pick items from
   their wardrobe grouped by body part; per-item verdict
   (`too_warm | too_cold | just_right`) + optional note; caption; up to 4
   photos (reuse the wardrobe lane's R2 sizing conventions — copy the
   pattern, do not import their internals).
2. **Entry detail page**: run stats, weather conditions (from DB; render
   `WeatherAttribution`), outfit with verdicts, photos, caption, likes.
3. **Follows**: follow/unfollow by profile; a minimal public profile page
   (display name, recent entries). All profiles public at MVP — document
   this as a known privacy decision for human sign-off in your design doc.
4. **Feed**: entries by followed users + self, `created_at DESC`,
   cursor-paginated (created_at + id cursor, htmx infinite scroll).
   **The query must be covered by the indexes named in
   `docs/architecture.md` — include the EXPLAIN QUERY PLAN output in your
   PR description** proving no table scan.
5. **Likes**: toggle via htmx fragment; count denormalized on the entry row
   is NOT allowed at MVP (count query is cheap and correct; revisit later).
6. **Empty states**: feed with no follows shows own entries + a
   find-runners-to-follow hint.

## Out of scope

Comments (moderation burden — deliberate product decision), reshares,
notifications for likes/follows, photo moderation (post-MVP), affiliate
links, entry visibility settings, blocking.

## Test expectations

- Authorization: entries only creatable on own runs; wardrobe picker only
  shows own items (cross-user test).
- Feed correctness: follows see entries, non-follows don't, self included,
  cursor pagination stable across inserts.
- Fragment render tests for entry card + feed page.
- One index-coverage test: assert EXPLAIN QUERY PLAN for the feed query
  contains no `SCAN` over outfit_entries or follows.

## Done criteria

Design doc reviewed (include one flowchart of the entry-creation flow from
notification → run → entry form). Verify + tests clean. Two local users can
follow each other and see each other's entries in the feed.
