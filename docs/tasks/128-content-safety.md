# Task 128 — Content & safety

Lane 4 of 5 building to the launch development plan. Read
`125-129-launch-development.md` first: it holds the rules every lane
shares, the migration protocol and the cross-lane seams.

A phone photo on a public entry can publish the runner's home coordinates
(finding 0.8). Nobody can delete what they posted, and a moderator's Remove
hides bytes without deleting them (0.9). A banned runner signs straight
back in and their posts stay in every feed (0.3). The CSAM tool, once
switched on, would scan none of our photos (§1.10). This lane makes what
people upload safe to publish and possible to take back.

## You own

- `src/modules/safety/**`, `src/routes/safety/**`
- `src/modules/feed/photos.ts`, `src/routes/feed/photo.$.tsx`
- `src/modules/closet/photos.ts`, `src/routes/closet/photo.$itemId.$size.ts`,
  and the photo block of `closet/components/GarmentDetail.tsx` (additions only;
  the rest of that component has no owner)
- `src/lib/photo-pipeline.ts`, `src/lib/photo-constraints.ts`
- New `src/modules/feed/retract.ts` and its components (entry and entry
  photo delete); new `src/modules/runs/delete-run.ts` and its component.
  Wiring them into `routes/feed/entry.$entryId.tsx` and
  `routes/runs/$runId.tsx` is additions only.
- `src/routes/desk/review*.tsx`, `src/routes/desk/runners*.tsx`
- `e2e/safety/`, `e2e/closet/` (the photo beats only), `test/safety/**`,
  `test/closet/photos*`, `test/feed/photos*`

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
Contract. Design ask for what they look like.

## Tests

Worker tests for every server path above; ui tests for every new control's
states; the browser project for SAF-2's downscale. Mutation stays at 100%
on `modules/safety`, `modules/feed/photos.ts`, `modules/closet/photos.ts`,
`src/lib`, and every `.tsx` you touch.

## Demos

- `e2e/safety/`: a ban from the Desk and the banned runner's sign-in; a
  moderator Remove.
- `e2e/feed/` (the photo beats): delete an entry photo, delete an entry.
- `e2e/run-logging/`: delete a run.
