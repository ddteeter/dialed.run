# Task 104 — Kit Entries, Feed & Social (parallel lane)

## Goal

The heart of v1: attach a kit to a run with a one-tap 5-state verdict,
photos, and a caption; follow other runners; scroll a reference feed. A run
appears in the feed only once it has a **public** outfit entry. Implements
A2/A2b/A3, E1, E2-lite, D (no comments), G, H (v1 variants), username
search. See docs/design-deltas.md #7–#10, #13–#14.

## You own

- `src/modules/feed/**` (outfit entries, follows, reactions, feed, profiles)
- `src/routes/feed/**`
- Tests under `test/feed/**`

You consume via index.ts only: `closet` (item picker data), `runs` (run
lookup + the entry-creation route their notification deep-links to —
coordinate the route name in your design doc), `weather` module's
`WeatherAttribution` + conditions read API.

## Requirements

1. **Attach the kit (A2/A2b)** for one of the user's runs: picker pre-filled
   from the user's nearest-conditions previous public-or-private entry
   ("MOST LIKELY · FROM 43° DAMP, AUG 14" — nearest |feels_like delta|, same
   precip class, most recent tiebreak; "That's it" accepts in one tap).
   Otherwise the condition-filtered picker: UI groups with match counts,
   A2b sheet per group (search, filters, multi-select, `[UNTESTED]` rows,
   hidden-by-filter count). Up to 4 photos (copy the closet lane's R2 sizing
   conventions — copy the pattern, do not import their internals).
2. **Verdict (A3)**: 5-point scale (int −2..+2), band counts from the user's
   own history shown under the choices; optional entry tags (curated list in
   contracts.ts); optional per-item flag/note; the teal "noted" confirmation
   ("Half-zip is now 8 of 9 in 38–46°"). Abandon-before-verdict: entry saves
   with verdict null; prompt once on next open, then never again.
3. **Sharing (D-19)**: `is_public` defaults from the user's `share_default`;
   per-entry toggle on A3 with copy noting the verdict label is shown on
   shared posts (D-12). Private entries never appear in any feed, profile
   (other than the owner's), or aggregate.
4. **Entry detail (D, v1)**: run stats, conditions (+ `WeatherAttribution`),
   kit with verdict badge, per-item rows (garment chips), photos, caption,
   useful count. No comments (D-04), no "try this kit" (D-09).
5. **Follows + profiles**: follow/unfollow; own profile (G v1): display
   name, city, thermal blurb ("runs average"), counts, temperature-coverage
   bar (verdict counts per 5°C band, pink/teal/grey per O6), most-worn
   pieces, recent entries. Other profile (H v1): public info + recent public
   entries only — no offset translation, no verdict aggregates. Public
   profiles at MVP — document as a known privacy decision in your design doc.
6. **Following feed (E1)**: public entries by followed users + self,
   `created_at DESC`, cursor-paginated (created_at + id, infinite scroll).
   **Covered by the indexes in docs/architecture.md — include EXPLAIN QUERY
   PLAN output in your PR description** proving no table scan.
7. **Your conditions (E2-lite, D-10)**: second feed tab. Viewer's current
   conditions (their lat/lng + now, via weather module; manual city if no
   location) → consensus block over public entries from the last 72h within
   ±3°C feels-like and same precip class: per-UI-group wear counts
   ("Long sleeve 15/18"), plus the count line. Empty state copy from
   docs/product.md (widen window before declaring empty). No stranger
   cards. Excludes manual-source observations. Document the query's scan
   bound in your design doc.
8. **Useful reactions (D-11)**: toggle; count denormalization NOT allowed at
   MVP (count query is cheap and correct).
9. **Username search**: prefix search on display_name, public profiles only,
   linked from E1's empty state.

## Out of scope

Comments (D-04), kits (D-09), full E2 / discovery ranking (D-10, D-18),
notifications for likes/follows, photo moderation (106), entry visibility
beyond the is_public flag, blocking (106 handles report/ban).

## Test expectations

- Authorization: entries only creatable on own runs; picker only shows own
  items (cross-user test); private entries invisible cross-user everywhere
  (feed, profile, detail, consensus).
- Feed correctness: follows see public entries, non-follows don't, self
  included, cursor stable across inserts.
- Consensus: window filtering (temp/precip/recency), manual-source
  exclusion, group aggregation counts.
- Verdict flow: null-verdict save, one-time re-prompt, band-count display.
- One index-coverage test: EXPLAIN QUERY PLAN for the following feed
  contains no SCAN over outfit_entries or follows.

## Done criteria

Design doc committed (include one flowchart: notification → run → attach →
verdict → share). Verify + tests clean. Two local users follow each other,
see each other's public entries, and the consensus block reflects both.
