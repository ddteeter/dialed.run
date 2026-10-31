# Design: 164 Moderation breakers

## Problem

Three automated paths hide content with no person involved: the fingerprint
hold on upload (D-147), the classifier flag, and the report threshold. A bug in
any of them, or a change in the model behind `omni-moderation-latest`, would
hide runners' photos in bulk. The fingerprint hold is the riskiest, because each
upload is compared with every kept row. A featureless image hashes to
`0000000000000000`, since `fingerprintOfGrid` sets a bit only when a pixel is
strictly brighter. A Photon change that empties `get_raw_pixels` would
make every hash zeros as well. Today the only signal is the daily digest's
"N item(s) awaiting moderation review". Nothing limits the hiding, and no
alert fires the same hour. (Owner, 2026-10-31. Model pinning was considered and
dropped, because it means keeping up with model releases by hand.)

## Approach

1. **Low-information fingerprints** (`lib/photo-fingerprint.ts`).
   `isDistinctive(fp)` is true when the popcount is inside a band (proposed
   8–56). `keptFingerprints` / `keptGarmentFingerprint` keep nothing outside
   it, and `removedMatchOf` never matches an upload outside it. The SQL keeps
   rows only. The band is checked in code on the given fingerprint.
2. **Hold breakers** (`safety/breakers.ts`, new). These keep no state: before
   holding, count the last hour's holds of that cause from `review_queue`
   (`source`, `created_at`). At or over the ceiling, don't hold, and fall back
   to what the system already does when degraded:
   - fingerprint → the photo goes to the classifier as any upload does;
   - classifier flag → the photo stays `pending` (visible only to its owner),
     the classifier-outage state, and the hourly retry owns it.
     The hold rate is therefore bounded during a bug, not merely detected. The
     breaker resets itself when the window drains, so the Desk has no switch.
3. **Report-hide breaker** (`safety/reports.ts`). This is item 5 of the
   2026-10-31 review, changed on purpose. Over the ceiling, a report
   still **queues** the subject but does not hide it, so no notice is owed. That
   replaces "hold the emails": under DSA Art. 17 a hide nobody was told of is
   not allowed, and delaying the notice would be exactly that.
4. **Trip alerts** (`ops/sentry.ts`). A trip sends one Sentry event,
   fingerprinted `["breaker", cause, day]`, through the same new-issue rule
   as design 162. Today shows a line while any breaker is over its ceiling.
5. **Too-quiet line** (daily digest). If the last 7 days screened ≥ 50 photos
   and the classifier returned no `flag` and no `review`, say so. This catches a
   model change in the direction the breaker can't see.
6. **Matches gap** (Review row, `PhotoMatches`). The list stops at
   `PHOTO_MATCHES_LIMIT`. Show "12+" when it is cut off, and before an
   `intimate` Remove, warn when the matches cover more than 3 runners. That
   many runners suggests a generic image, not a single photo copied around.
7. **Release a burst** (Desk). Approve every pending hold of one cause
   created since a time, in chunked batches. Each item gets what a single
   Approve writes: audit row, back to `pending`, re-screened.

## Contract touches

- Schema changes needed: **none.** The counts read `review_queue`, and the
  quiet line reads `photo_screenings`. Whether existing indexes cover both is
  a step-1 check, and a new index is additive.
- New route files: none expected. The release action is a server function
  called from the Desk.
- New bindings/queues/crons: **none** (the digest and hourly firings exist).
- Screens: Desk Today (breaker line), Review (12+, many-runners warning,
  release). The copy is operator-facing only.

## Test plan

- worker: `isDistinctive` at the band edges; a flat or empty grid is not
  distinctive; nothing outside the band is kept or matched.
- worker: each breaker holds at ceiling − 1 and falls back at the ceiling,
  counting only its own cause and only inside the window.
- worker: a report over the ceiling queues without hiding or noticing.
- worker: a trip raises one Sentry event a cause a day. The quiet line fires
  only with enough volume.
- worker: release approves only the matching cause and window, with audit rows.
- ui: 12+ label, many-runners warning, release confirm.

## Open questions

- **Ceilings** (proposed, pre-launch scale): fingerprint 5/h, classifier
  flag 10/h, report hides 10/h. These are fixed numbers now. A share of
  uploads later, once there is volume to take a share of.
- **Popcount band 8–56**: I'm proceeding on it. I'll measure it against the
  design-146 fixtures and any eval photos before settling.
- **Do `intimate` 1-report hides bypass the report breaker?** Proposed: yes.
  The 48-hour clock, and the harm of one more viewer, outweigh a burst bug on
  a path a person files one report at a time.
