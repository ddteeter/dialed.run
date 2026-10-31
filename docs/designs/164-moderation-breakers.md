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
   (`source`, `opened_at`). `created_at` won't do: `enqueueForReview`
   reopens an existing row on conflict and keeps its first `created_at`, so
   a re-hide would go uncounted. At or over the ceiling, don't hold, and fall
   back to what the system already does when degraded:
   - fingerprint → the photo goes to the classifier as any upload does;
   - classifier flag → the photo stays `pending` (visible only to its owner),
     the classifier-outage state, and the hourly retry owns it.
     The hold rate is therefore bounded during a bug, not merely detected. The
     breaker resets itself when the window drains, so the Desk has no switch.
   **Ceilings** (owner, 2026-10-31). Each scales with what drives it:
   - fingerprint: **fixed 5/h**. Re-uploads of removed images don't grow
     with traffic.
   - classifier flag: **over 15% of the hour's screened photos, with at
     least 20 screened**.
   - report hide: **the larger of 10/h and 4× the busiest hour of the
     trailing 28 days**. The baseline is read only once the hour is over 10.
     It counts only reports on entries and photos, the types a report can
     hide (owner, 2026-10-31). A flood of profile or product reports can't
     pause hides of posts, and still shows in Review's waiting count.
3. **Report-hide breaker** (`safety/reports.ts`). This is item 5 of the
   2026-10-31 review, changed on purpose. Over the ceiling, a report
   still **queues** the subject but does not hide it, so no notice is owed. That
   replaces "hold the emails": under DSA Art. 17 a hide nobody was told of is
   not allowed, and delaying the notice would be exactly that.
4. **Trip alerts** (`ops/scheduled.ts`). Today's line wording was approved
   as written (owner, 2026-10-31; design-deltas item 93). A trip sends one Sentry event,
   fingerprinted `["breaker", cause, day]`, through the same new-issue rule
   as design 162. Today shows a line while any breaker is over its ceiling.
5. **Headroom and too-quiet lines** (daily digest). Each cause's busiest
   hour **of the last day** as a percentage of its ceiling, said at 50% or
   more, so the ceilings are revisited before growth trips them. It was
   planned as a week, but the digest reads every morning, so a week would
   report one busy hour seven times. Separately: if the last 7 days screened ≥ 50 photos
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

- Schema (additive, so proceed per `.claude/rules/schema.md`):
  `0073_add_review_queue_opened_at` adds nullable `review_queue.opened_at`,
  set on insert and on reopen and backfilled from `created_at`, with index
  `(source, opened_at)`. `0074_add_photo_screenings_created_index` adds
  `photo_screenings(created_at, decision)` for the classifier share and the
  quiet line. **Numbering**: PR #277 also takes 0073–0074 (it already
  collides with main's 0072). A gap fails `migration-chain`, so these go
  in sequence, and whichever PR merges second renumbers its migrations
  (law 11).
- New route files: none expected. The release action is a server function
  called from the Desk, and it needs a row in `verification-class.test.ts`
  (Desk class, as the other Desk writes).
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
- worker: a reopened queue row stamps `opened_at`. The headroom line's
  percentage is pinned.
- ui: 12+ label, many-runners warning, release confirm.

## Open questions

- **Ceilings** (proposed, pre-launch scale): fingerprint 5/h, classifier
  flag 10/h, report hides 10/h. These are fixed numbers now. A share of
  uploads later, once there is volume to take a share of.
- **Popcount band 8–56**: provisional (owner, 2026-10-31). **Settle before
  step 11** against real run/kit photos the owner is collecting. Measure
  them locally and commit only the numbers. Synthetic results (step 0,
  Photon's Triangle resize): flat, black, white and the left→right and
  top→bottom gradients set 0 bits, the right→left gradient sets 64,
  near-black/near-white/low-contrast noise set 3/4/7, full noise sets 30.
  The 200 seeded `scenes.ts` pictures run min 3, p5 11, median 22, p95 34,
  max 37. They skew low because their background brightens to the right,
  as a photo lit from one side would. So 8 may be too high a floor.
- **`intimate` 1-report hides bypass the report breaker** (owner,
  2026-10-31). The 48-hour clock, and the harm of one more viewer, outweigh a
  burst bug on a path a person files one report at a time.

## Steps

Every step ends with the commit gate, touched-file stryker at 100%
(`--mutate "<file>"`, never a bare `stryker run`), and one commit.

| #  | builds | tested by | done when |
| -- | ------ | --------- | --------- |
| 0  | **Measure the band.** `test/fixtures/scenes.ts` gains flat, near-black, near-white, one-way gradient, low-contrast and noisy scenes. Seeded scenes stand in for ordinary photos. Record the popcount of each in this doc. | a fixture test listing each scene's popcount | 8–56 is confirmed or moved, with the numbers here |
| 1  | **`isDistinctive`** in `lib/photo-fingerprint.ts`. The keep paths in `removed-fingerprints.ts` keep nothing outside the band, and `removedMatchOf` answers nothing for an upload outside it. | band edges 7/8/56/57; a flat grid; an empty pixel buffer; worker tests for both keep paths and the match | a flat removed image keeps no row, and a flat upload is never held |
| 2  | **Schema**: migrations 0073 and 0074. `enqueueForReview` stamps `opened_at` on insert and on reopen. | `migration-chain`; fresh-D1 apply; worker test on reopen | the migrations apply to a fresh local D1 |
| 3  | **`safety/breakers.ts`**: `holdsInLastHour(cause)`, the three ceiling rules as pure functions, and `isOverCeiling(cause)`. | each rule at ceiling − 1 / ceiling; share below 20 screened; baseline read only over 10; other causes and outside the window not counted | pure rules at 100% mutation |
| 4  | **Fingerprint breaker** wired into `feed/photos.ts` and `closet/photos.ts`: over the ceiling → no hold, the photo goes to the classifier. | worker tests on both upload paths at and over the ceiling | the 6th hold in an hour is screened, not held |
| 5  | **Classifier breaker** in `screening.ts`: when a `flag` lands over the ceiling, write nothing and leave the photo `pending`. `retryPendingScreenings` counts these separately. | worker tests: flag over the ceiling stays pending with no queue row; review/pass unaffected | flags stop hiding once over 15% |
| 6  | **Report-hide breaker** in `reports.ts`: over the ceiling, `fileReport` and `reconcileUnhiddenReports` queue without hiding and send no notice. `intimate` bypasses. | worker tests: queue-only over the ceiling; intimate still hides and notifies; the sweep doesn't re-hide later | no `content_hidden` notice while tripped |
| 7  | **Trip alerts**: one Sentry event per cause per day (`["breaker", cause, day]`), plus a Today line while any cause is over. | worker test on the event and its dedupe; dom test for the Today line | a trip in the worker test reaches the Sentry stub once |
| 8  | **Digest lines**: headroom (weekly) and too-quiet. | worker tests at 49/50/51% and at 49/50 screened | both lines appear, and stay away on an ordinary week |
| 9  | **Review matches gap**: "12+" when cut off, and the many-runners warning before an `intimate` Remove. | dom tests on `PhotoMatches` / `RemovalDecision` | the warning names the runner count |
| 10 | **Release a burst** on the Desk: cause + since, confirm, then chunked approves with audit rows. | worker test on scope and audit; dom test on the confirm; `verification-class` row | releasing 30 held photos returns them all to `pending` |
| 11 | **pr-ready**: self-review, `docs/architecture.md` if a boundary moved, demo video of the Desk changes, PR. | the skill's checks | PR open; push run in the background |
