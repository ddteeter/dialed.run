# Before-public plan

What is left to **build** before the public stage: the first stranger, someone
who got an invite code by requesting access rather than from the owner
(decision D-38). This continues `docs/launch/development-plan.md` and is
written from a read-only audit of `main` at b068580 (2026-10-11).

**Where the dev plan stands.** Of its 45 `[P]` items, 37 are done, 2 are
superseded (OPS-16's per-entry card and FEED-14, both by D-107) and 1 was
dropped (SAF-7, D-69). Four are partial. Separately, eight register rows
or decisions tagged before-public are not built. Both lists are below.

Request access (ACC-5) is already built, Turnstile-guarded, and listed on
Desk D7. The CSP (OPS-8) is built but still **report-only**.

**Out of scope here:**

- The deployment sweep (`docs/launch/deployment-plan.md`).
- The owner's legal text: the D-108 Terms and Privacy wording, ACC-13's
  brackets, and "continued use".
- The open `/takedown` stack (#169 → #170, #173, #176), which another
  session owns. This plan sequences around it rather than into it.

## What is left

| id                | status      | remaining work                                                                                                                                                     |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| STR-9             | partial     | Nothing sends the `run_reminder` email. The template, the preference and the outbox fields exist; `runs/consumer.ts` writes only the bell row.                     |
| SAF-4             | partial     | `AccountClosed` is mounted nowhere, and `ACCOUNT_CLOSED` is mapped in neither `auth/credentials.ts` nor `google-button.tsx`. A banned runner sees a generic error. |
| FEED-3            | partial     | `capped()` says "9+ new" where round 27 #25 says "more than 9 new" (R-141(1)). 14 routes pass only `unreadCount`, so their bell shows a dot and no number.         |
| FEED-9            | partial     | E1's compact line and N's privacy-card wording are missing (`design-deltas.md:3848`, "Not built").                                                                 |
| R-124 / D-98      | not started | Change password calls Better Auth from the client and skips `auth/password-check.ts`. It needs a server function with the per-runner lockout.                      |
| D-108 (D)         | not started | "Count my runs in anonymous totals": no column and no setting.                                                                                                     |
| D-108 (E)         | not started | The three in-app disclosures: A3's PRIVATE sub-line, the Settings copy, and Au2's legal sentence.                                                                  |
| D-108 (d) region  | not started | Settings › Profile › Region: no columns, no setting, not in `profile.csv`.                                                                                         |
| R-134             | not started | The nightly guide artifact. **It needs a `wrangler.jsonc` binding.**                                                                                               |
| R-135             | not started | Export's runs sheet lacks `moving_s` and `elevation_gain_m`. The columns have existed since 0047.                                                                  |
| R-142             | done (C2)   | Deletes on disconnect, deauthorize and purge were already built; C2 made the 7-day prune count from the first failure.                                             |
| R-140             | not started | Takedown wording: the barrel export, the `content_removed` email variant, and `notice` passing `input.action`.                                                     |
| R-145 (c) / D-117 | not started | The Review row should list the runner's other photos. (a) and (d) ride #169.                                                                                       |
| OPS-8             | report-only | Enforcing it means flipping `CSP_HEADER` in `ops/security-headers.ts` and the copy in `public/_headers`.                                                           |

Drift worth folding in while a lane is in the file:

- STR-13: three private Intl date formatters remain (`AccountClosed.tsx:12`,
  `ops/components/Today.tsx:48`, `closet/retired-label.ts:17`).
- OPS-11: the digest is sent without checking that the owner's address is
  verified.
- OPS-16: `entryCardResponse` has no caller under D-107 and is dead code.

## Decisions for the owner

These are asked now rather than flagged. Each lane builds to the bracketed
default only where a default is safe.

1. **The `wrangler.jsonc` change for R-134**: an R2 binding to `dialed-guides`
   and a nightly cron trigger. R-134 records it as owner-approved and
   "confirmed at build time". **Approved 2026-10-11.** Lane B itself moves to
   soon after public (see lane B): the artifact is rebuilt nightly from all
   history, so nothing is lost by waiting, and at friends scale the
   thresholds would suppress almost every figure. It comes forward only if
   the marketing site needs guides at launch.
2. **When the CSP enforces.** No production traffic has been through the
   report-only header yet. Recommendation: lane C fixes every violation the
   e2e and demo suites produce locally, and the flip ships as its own
   one-line PR, merged at the public gate after the friends stage's Sentry
   reports are clean. The flip is then a deployment-plan row, not a dev
   item. [That. Agreed 2026-10-11: enforcing before friends would be
   harmful.]
3. **Legal text for D-108 (E).** Au2's sentence links to Terms and Privacy,
   which don't mention aggregates yet. The in-app sentence ships with the
   drawn copy. **The owner asked for the legal paragraphs to be drafted by
   an agent (2026-10-11)** on `docs/d108-legal-totals`; the owner reviews
   the wording in that PR. They must be in Terms v1
   (D-93) so they don't trigger a second acceptance prompt. **They are needed
   before friends**, not before public, because every Terms change after
   friends accept is a second prompt. The same applies to #169's edits to
   `docs/legal/`: settle them before the friends deploy.
4. **D-108's fallback.** "If A or B can't be met at launch, ship
   shared-only." Lane B builds A–C in full; if the thresholds leave the
   artifact nearly empty with friends-scale data, that is expected and is
   not the fallback. [Build the full rule.]

Open decision 3 in the dev plan, flipping the invite flag at public, stands.
It is a code constant (`lib/contracts/access.ts:15`), so flipping it is a
deploy. Nothing here changes it.

## Lanes and stages

Rationing holds: at most three agents, and one Stryker run or push gate at
a time machine-wide. Each lane is one worktree and one PR, gets an
independent review, and has its findings fixed before merge.

**New migrations number 0056 or later**: #169 claims 0054 and #176 claims 0055. Whichever lane merges second renumbers (law 11).

**Two stages, not one** (owner, 2026-10-11). Most of what is left can wait
for strangers. Two things cannot wait for friends:

- **D-108's opt-out and disclosures.** The setting defaults to on, so a
  private run logged before it exists would count in published totals its
  runner was never told about.
- **R-142.** Friends hold real Strava grants, and the agreement requires
  deleting a runner's data on disconnect.

R-124 rides along because it is cheap. So the slices are:

- **Before friends:** lanes A and F, plus the D-108 legal text
  (decision 3).
- **Before public:** lanes C, D1 and D2, and the CSP flip.
- **Soon after public:** lane B.

Three things are deliberately **kept out of the friends deploy**:

- Enforcing the CSP. Report-only during friends is how its gaps get found.
- Running the guide artifact in production before the disclosures and the
  legal text are live (lane B, step 6).
- The reminder email, unless its dedupe and redelivery tests are solid.
  Its failure mode is emailing friends repeatedly.

### Stage 1: before friends

**Lane A · D-108 opt-out, region and disclosures** (126 with onboarding and
logging; schema: additive)

1. **Migration `add_profile_aggregate_prefs`** (0056+): on `user_profiles`, a
   `count_in_totals` integer boolean (not null, default 1), plus nullable
   `region_country` and `region_subdivision`. Additive, so it is announced
   in the PR and nothing waits.
   _Test:_ `migration-chain.test.ts` passes, and a worker test reads the
   defaults back from a fresh profile.
   _Done:_ it applies on a fresh D1 and the chain is linear.
2. **One writer each**, in onboarding's module and exported through its
   index: `setCountInTotals` and `setRegion`. Both use `verifiedUserId()`
   (D-113: they affect what is published) and get rows in
   `verification-class.test.ts`. The region is validated by zod against an
   ISO 3166 list kept in `lib/contracts/`: country, plus a subdivision only
   where the country has one in the list.
   _Test:_ worker tests for each writer, covering invalid input, a
   subdivision without a country, and an unverified caller.
   _Done:_ both are mutation-clean under the onboarding scope.
3. **Settings › Sharing**: the toggle and its drawn on and off copy, saving
   on toggle with §4a's `NOT CHANGED` band on failure and no confirm. The
   "How the guides are made" link goes to a placeholder target, recorded in
   design-deltas, because the marketing site owns `/how-it-works`.
   _Test:_ a `.dom.test.tsx` for both states and the failure band.
   _Done:_ matches `design-deltas.md:1573-1580`.
4. **Settings › Profile › Region**: a new section in
   `onboarding/route-decisions.ts`, with the drawn hint, off by default.
   _Test:_ DOM tests for empty, set and cleared.
   _Done:_ it is never rendered on a profile or entry, and a test asserts
   that.
5. **`profile.csv`** gains the region columns and `count_in_totals`, each
   with an `about` line. Fold R-135's two runs-sheet columns into this
   step, since it is the same file.
   _Test:_ the export-sheets tests.
6. **Disclosures**: A3's PRIVATE sub-line, with Change opening Settings ›
   Sharing as a sheet and keeping the form's values, and round 27's
   unverified line taking precedence. Also Au2's one sentence. Opted out,
   A3 reads "Only you see this run."
   _Test:_ DOM tests for opted in, opted out and unverified, plus a sheet
   round trip that keeps the form's values.
   _Done:_ the demo is re-recorded (the A3 and Au2 journeys change).

**Lane F · Strava erasure, the password lockout and the rename guard** (126 and 127; no
schema change)

1. **R-142**: delete `gave_up` rows whose subject starts with the athlete
   id, inside the existing deauthorize and purge batches (one batch, no
   split). Add a prefix delete beside `db/gave-up.ts`'s exact-match one.
   `src/db/gave-up.ts` is not `schema*`; the lane confirms that before
   editing.
   _Test:_ worker tests showing a deauthorize and a purge leave no matching
   row and leave other athletes' rows alone.
2. **R-124**: a `changePassword` server function in `modules/auth` that
   checks `password-check.ts`'s per-runner count before calling Better
   Auth's server API, and the drawn `currentPasswordLimited` frame. The
   client no longer calls Better Auth directly for this.
   _Test:_ worker tests for under the limit, at the limit (refused before
   the provider call) and a reset after success; a DOM test for the frame;
   a `verification-class` row.
   _Done:_ there is no client-side `changePassword` call (an architecture
   test pins it).
3. **R-121** (owner, 2026-10-11): `forceRename`'s update becomes
   conditional on the handle the read saw, and the history row is written
   only when it matched, in the same batch. Plus the comment saying why the
   history lookups are `COLLATE NOCASE`. In `account/username.ts` and
   `safety/rename.ts`, clear of the takedown stack.
   _Test:_ two renames racing from the same previous handle leave one
   history row and the first rename intact.

### Stage 2: before public

**Lane C · account and safety fixes** (126 and 128; no schema change)

1. **SAF-4**: map `ACCOUNT_CLOSED` in `auth/credentials.ts` and
   `google-button.tsx`, and mount `AccountClosed` (design-deltas item 23).
   Replace its private date formatter (STR-13).
   _Test:_ DOM tests for both sign-in paths, and an e2e assertion in the
   safety demo that a banned runner sees the drawn refusal.
2. **OPS-11**: send the digest only to a verified owner address; otherwise
   record it on the Desk.
   _Test:_ a scheduled-handler test for each case.
3. **CSP readiness (decision 2)**: run e2e and the demos locally with the
   header enforced as a local experiment, never committed. Fix each
   violation in code (nonces, a moved inline style, an allowed origin),
   and record the evidence in the PR.
   _Done:_ zero violations across the suites. The flip PR is drafted, not
   merged.
4. **Dead code**: delete `entryCardResponse` (OPS-16) and its test, unless
   knip shows a caller.

**Lane D1 · notifications and feed** (127 and 129; no schema change unless
step 1 proves it needs one)

1. **STR-9**: owe a `run_reminder` email 20 minutes after a run lands
   through the outbox, with `notBefore` and a per-runner-per-day
   `dedupeKey`, in the same batch as the bell row. Skip it if a matching
   upload has arrived by send time, and honour the preference. The next
   day's email counts both runs. If the per-day key cannot express "one a
   day", stop and ask before adding a column.
   _Test:_ worker tests for owed, skipped by upload, deduped within a day,
   opted out, and a redelivered message (law 1).
   _Done:_ the consumer and the dispatcher are mutation-clean.
2. **FEED-3**: "more than 9 new" (R-141(1)), and the 14 routes get the
   bell's count. Thread `bellStateFn` through the shared layout loader
   rather than 14 route edits if the layout allows it; otherwise use one
   helper the routes call.
   _Test:_ the bell's DOM tests; an architecture test that every
   bell-bearing route passes a count.
3. **FEED-9**: E1's compact line and N's privacy-card wording, with the
   data read in the E1 loader behind an index (an EXPLAIN test).
   _Done:_ `design-deltas.md:3848` is marked built, and the feed demo is
   re-recorded.
4. **STR-13**: the two remaining formatters (`Today.tsx`,
   `retired-label.ts`).

**Lane B · R-134 guide artifact (soon after public).** Needs lane A merged;
the binding is approved (decision 1).

1. The binding and the cron, in `wrangler.jsonc` (owner-approved),
   `src/env`, `ops/crons.ts` and `bindings-conformance.test.ts`.
2. **A reader of only the counted fields**: feels-like band, sky, month,
   garment type and catalogue model, verdict, and region if set. It sits in
   a module whose query selects nothing else, and a test pins the selected
   column list. It reads confirmed accounts with `count_in_totals = 1`,
   excluding removed or quarantined entries, banned or leaving accounts,
   and `source='manual'` weather. Shared and private runs both count.
   Closet pieces count only when worn on a counted run.
   _Test:_ worker tests for each exclusion.
3. **Thresholds**: suppress any figure under 5 distinct runners (20 for a
   brand) at build time.
   _Test:_ boundary tests at 4/5 and 19/20.
4. **Write `guide-artifact/v1.json`** to the HANDOFF v1 shape (D-105),
   idempotently. A rerun overwrites with the same bytes for the same data.
   A failure lands in the digest (law 6).
   _Test:_ a cron test against a local R2.
5. **Deployment rows**: the bucket, the read-only token and the site's
   secrets, added to `deployment-plan.md` §2. No secret is written anywhere.
6. **The production gate**: the cron does not run in production until lane
   A's disclosures and the D-108 legal text are live. Add that as a
   deployment-plan row and keep the cron out of the friends deploy.
   Otherwise it would publish figures built from private runs whose
   runners were never told.

**Lane D2 · takedown follow-ups.** After #169 and #176 merge, because they
own `email/content.ts`, the safety barrel and `ReviewQueue.tsx`.

1. **R-140**: export `takedownSentence`, add the takedown `content_removed`
   variant, pass `input.action` through `feed/moderation.ts`'s `notice`, and
   mount `ContentRemoved`.
2. **R-145 (c)**: the Review row lists the runner's other photos. Read them
   behind an index, and re-record the safety demo.
   W1's link to `/takedown` is undrawn, so it becomes a design-deltas entry
   rather than a build.

**The CSP flip**: a one-line PR from lane C's draft, merged at the public
gate (decision 2).

## Order and merge

- **Stage 1** runs lanes A and F in parallel, which is two agents. Both
  merge before the friends deploy.
- **Stage 2** runs lanes C and D1 next, then D2. That is three agents at
  most. Lane B follows the public launch.
- **Lane A merges before lane B starts.** Lane B's reader depends on the
  `count_in_totals` column.
- **D2 starts when the takedown stack has merged.** Rebasing onto #169 is
  not enough: #176's migration and `email/content.ts` change land with it.
- **Every lane's PR:**
  - runs `docs/pr-self-review.md`;
  - lists its undrawn surfaces under "Design deltas";
  - re-records a demo where a reviewer would see a change (A, F step 2, C step 1,
    D1 steps 2–3, D2);
  - is merged once green, with its review findings fixed.
- **When the last lane merges**, `development-plan.md` is updated:
  - STR-9, SAF-4, FEED-3 and FEED-9 are marked done;
  - FEED-14 and open decision 7 are marked superseded by D-107;
  - the register rows close in `docs/deferred.md`.

## Not in this plan

- The public `/takedown` page and its abuse limits (#169 and #176) and the
  D-117 amendment #169 proposes. Those are that session's, and the
  amendment is yours to sign off there.
- Flipping `IS_INVITE_ONLY` (open decision 3).
