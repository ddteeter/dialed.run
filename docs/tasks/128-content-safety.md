# Task 128 — Content & safety

Lane 4 of 5 building to the launch development plan. Read
`125-129-launch-development.md` first: it holds the rules every lane
shares, the migration protocol and the cross-lane seams.

A phone photo on a public entry can publish the runner's home coordinates
(finding 0.8). Nobody can delete what they posted, and a moderator's Remove
hides bytes without deleting them (0.9). A banned runner signs straight
back in and their posts stay in every feed (0.3). The CSAM tool, once
switched on, would scan none of our photos (§1.10). And the privacy policy's
drafter found three more (PR #109): blocks hide nothing, a reporter's own
hide is not applied, and two signed-in pages' data answers signed-out
requests. This lane makes what people upload safe to publish and possible
to take back, and makes the safety controls do what they say.

**It also owns the closet for this sweep.** Round 26 carries four closet
items and the plan had no closet lane; the photo work already put this lane
in `modules/closet`.

## You own

- `src/modules/safety/**`, `src/routes/safety/**`
- `src/modules/feed/photos.ts`, `src/routes/feed/photo.$.tsx`
- `src/modules/closet/**`, `src/routes/closet/**`
- `src/lib/photo-pipeline.ts`, `src/lib/photo-constraints.ts`
- New `src/modules/feed/retract.ts` and its components (entry and entry
  photo delete); new `src/modules/runs/delete-run.ts` and its component.
  Wiring them into `routes/feed/entry.$entryId.tsx` and
  `routes/runs/$runId.tsx` is additions only.
- `src/routes/desk/review*.tsx`, `src/routes/desk/runners*.tsx`
- In `src/modules/feed/functions.ts` (129's), additions only: the session
  checks on `entryDetailQuery` and `otherProfileQuery` (SAF-14)
- `e2e/safety/`, `e2e/closet/`, `e2e/conformance/closet-*`, `test/safety/**`,
  `test/closet/**`, `test/feed/photos*`

## Work

**SAF-1 · EXIF stripped on the server [F]** (0.8). Every photo is
re-encoded before it is stored — entry photos with or without W3's blur,
garment originals too — so no metadata survives. Photon is already the
decoder. Tests: a fixture carrying GPS EXIF comes back from the photo
route with none, for an entry photo uploaded blur-off and for a garment
original.

**SAF-2 · Photo size, register D-3 [F]** (decision D-45). The browser
downscales before upload, capping the long edge (about 2048px) inside the
existing W3 canvas step, so a blur-off upload goes through the canvas too.
The server refuses anything over a decoded-pixel budget, read from the
header before decoding. Tests: an oversized fixture is refused with the
schema's message and never decoded; the browser project checks the
downscale.

**SAF-3 · Delete your own entry, run and entry photo [F]** (0.9, §2.5).

- Server functions for each, owner-scoped. D1 change and an outbox row in
  one `db.batch()`, R2 deletion as the fast path, the outbox drain for the
  rest — claim, then delete, so there is never a row pointing at a deleted
  object. New outbox kinds follow law 9.
- Deleting a run with an entry: say in the design doc what happens to the
  entry (the product default: the entry goes with it) and ask if unsure.
- **These are the primitives 126's account deletion calls** (seam 4). Export
  them through the modules' `index.ts`, sized for "all of a user's", not
  just one.
- Design ask: the D/E1 overflow, the run-detail action and the confirms.
- Tests: the row and the R2 objects are gone; a failed R2 delete is retried
  by the drain; another runner's entry cannot be deleted.

**SAF-4 · Bans that work [P]** (0.3, §5).

- **Sign-in blocked**: `banStateOf` enforced where a session is created, and
  existing sessions revoked (already done). The banned runner sees Operator
  Screens D4.
- **Content hidden everywhere**: extend `publiclyVisibleEntry()` so a banned
  author's entries fail it. That one rule reaches every feed read; 129
  applies it to search and profiles (seam 6).
- **A Desk ban control**, D3's ban panel, on the runner's page and on a
  profile report's review row, where "Remove" is a no-op today.
- **The ban notice email** through 126's interface (after ACC-2), with the
  reason and how to appeal.
- Tests: a banned runner cannot sign in; their entries leave the feed,
  entry detail and Your conditions; unbanning restores both.

**SAF-5 · A moderator's Remove deletes [P]** (0.9, §1.10). Remove deletes the
bytes, through the same outbox path as SAF-3. **Except** when the
moderator marks it as suspected CSAM: then it is **quarantined** — moved to
a prefix no route serves, kept for the preservation period the owner's
NCMEC procedure sets (deployment plan §8) — and purged from the cache.
Tests: a Remove leaves no object; a quarantine leaves one object, under the
quarantine prefix, unreachable from every route.

**SAF-6 · Admin takedown [P]** (§1.2). A Desk action to remove a named photo
or entry for a copyright notice: delete the object, null the key, write an
audit row (`add_moderation_actions`, additive, yours; also records SAF-5's
actions). Tests: the object is gone and the audit row names who, what and
why.

**SAF-7 · Signed URLs for public photos [P]** (decision D-46; D-71, §1.10).

- A public, screened entry photo is served at a URL carrying an expiry and
  an HMAC over the key and expiry, with `Cache-Control: public` for no
  longer than the URL lives. Bucket the expiry (to the hour, say) so the
  cache has a few URLs per photo, not one per view.
- A private entry's photo and every closet photo stay `private`, as today.
- Screening still gates every photo; an unscreened one gets no public URL.
- On removal (SAF-5, SAF-6, a runner's delete, a hide), the cached copies
  are purged or expire; say which in the design doc. Purge needs a
  zone-scoped API token (a secret, set in the deployment sweep); if you
  rely on TTL alone, the TTL is the purge bound and must be short.
- The signing secret's name goes in `src/env/env.d.ts` and the deployment
  plan's secrets table.
- Tests: an expired or tampered URL is refused; a private photo never gets
  a public header; the TTL never exceeds the URL's life.

**SAF-8 · Content-removed notice [P]** (§4, §1.4). The author learns what was
removed and why: an S1 row and an email through 126. The reason is the
statement of reasons the EU DSA asks for (decision D-40 keeps EU users).

**SAF-9 · D-62, the safety half [P].** Export a predicate for "this entry is
hidden pending review, and the viewer is its author". 129 renders the marker
(FEED-6).

**SAF-10 · D-69 [P].** A garment whose photo is flagged tells its owner the
photo is being checked, on garment detail. Design ask.

**SAF-11 · D-84(b) [P].** W3's tap-to-blur gets a keyboard path: focusable
controls named by position ("Blur top-left"), per the Accessibility
Contract. Design ask for what they look like. And W3's counts are digits,
always, "You blurred 1 spot." included (round 26 #18).

**SAF-12 · Blocks are enforced [F]** (D-107, PR #109). `hiddenCounterpartIds`
and `isBlocked` are exported from safety and imported by nothing, so a block
hides nothing: W2 promises what the code does not do. Make the one
visibility rule viewer-aware, so a blocked pair's entries leave each other's
feeds, entry detail, Your conditions' strangers and notifications, in SQL
(not a post-query filter, which breaks `LIMIT`). 129 applies the same rule
to search and profiles (FEED-7). Tests: after a block, neither runner sees
the other's entry anywhere; unblocking restores it; the consensus counts are
unchanged (blocks do not touch counts, per `docs/contracts.md`).

**SAF-13 · A reporter's own hide [F]** (D-108, PR #109). W1 promises
"hidden from your feed straight away", and `reportedSubjectIdsFor` has no
callers. The same viewer-aware rule hides what the viewer reported, from
the viewer only. Test: the reporter stops seeing it at once; nobody else
does until the threshold.

**SAF-14 · Signed-out requests refused [F]** (D-109, PR #109).
`entryDetailQuery` (`optionalUserId`), `otherProfileQuery` (no auth check)
and the entry photo route answer signed-out requests though their pages
require sign-in. Require a session on both queries (additions to feed's
`functions.ts`); the photo route takes a session **or**, after SAF-7, a
valid signature. **Leave room for 129's FEED-14**: a crawler fetching a
public entry's link preview is signed out, and gets the head meta only
(open decision 7), never the data. Tests: each refuses a signed-out request;
a signed-in one is unchanged.

**SAF-15 · The report sheet names the handle [P]** (round 26 #7).
"Report 's entry?", after ACC-1. Report also waits for verification: open
126's "Confirm your email first" sheet for an unverified runner (seam 7).

**SAF-16 · Closet: delete a garment that has runs [P]** (round 26 #3). The
drawn sheet: "Delete the {piece}? Retire it instead.", the GOES/STAYS rows,
"This can't be undone.", pink **Retire it**, hairline **Delete it and its
record**, Cancel, no second confirm; success lands on C with "{piece}
deleted."; failure is `Not deleted`. PR #101 built the delete itself.

**SAF-17 · Closet: F, garment saved and photo refused [P]** (round 26 #4).
The form fields go and the action becomes **Done** (to Y). Under the well,
`PHOTO NOT ADDED` · "Garment saved, photo didn't. Try again?" plus the
reason. **Try again only for a network failure**, re-sending the same file;
a size or type refusal offers only "Pick another".

**SAF-18 · Closet: F at the desk [P]** (round 26 #10). DS1's split; the rail
holds one card, "Already in your closet · {CATEGORY} · {TYPE}": same category
and type, newest first, up to five, retired pieces marked `RETIRED`, a
brand+name match marked `SAME NAME`, read-only and unlinked; "No half-zips
yet." when empty; no card before a category is picked.

**SAF-19 · Closet confirms [P]** (round 26 #9). "Show retired (4)", with no
count at 0; the phone's way back reads "← Closet".

## Tests

Worker tests for every server path above; ui tests for every new control's
states; the browser project for SAF-2's downscale. Mutation stays at 100%
on `modules/safety`, `modules/closet`, `modules/feed/photos.ts`, `src/lib`,
and every `.tsx` you touch. Conformance specs for round 26's closet frames
("Y Delete with runs", "F Photo failed", "F Add garment desk").

## Demos

- `e2e/safety/`: a ban from the Desk and the banned runner's sign-in; a
  moderator Remove.
- `e2e/feed/` (the photo beats): delete an entry photo, delete an entry.
- `e2e/run-logging/`: delete a run.
- `e2e/safety/`: a block that now hides; a report that hides for the
  reporter.
- `e2e/closet/`: delete with runs; photo refused after save; F at desk.
