# Design: 128 content & safety

## Problem

Photos can publish a runner's home (0.8), nothing can be deleted (0.9), a
ban does one of its three jobs (0.3), and blocks, a reporter's own hide and
the signed-out check are promises the code does not keep (D-107–D-109).
This lane makes uploads safe to publish, makes them possible to take back,
and makes the safety controls do what their copy says.

## Approach

**Two PRs.** PR 1 is enforcement and deletion — the [F] items plus the
server half of bans (SAF-1–4, 9, 12–14). PR 2 is moderation and the closet
(SAF-5–8, 10, 11, 15–19) and carries the one migration.

**One visibility rule, viewer-aware** (`safety/visibility.ts`).
`publiclyVisibleEntry(viewerId?)`: shared, `ok`, and the author not banned
— always. Given a viewer it also drops a blocked pair (either direction)
and entries the viewer reported. All three are `NOT EXISTS` subqueries on
existing indexes (`user_profiles` pk, `blocks_pk`,
`reports_one_per_reporter`), so `LIMIT` stays honest. No viewer is the
anonymous form: the consensus aggregate keeps it, so blocks and reports do
not move counts (`docs/contracts.md`) while a banned author's entries stop
counting. Call sites that show entries to a person pass the viewer: the
following feed, entry detail (which also starts applying `ok` — it read
`is_public` alone), the photo route and Useful. Those are one-argument
edits in 129's files, and the only ones this lane makes there; search and
profiles are 129's (FEED-7). There are no social notifications yet, so
nothing to filter there today — 129 applies the rule when they arrive.

**SAF-14.** `entryDetailQuery` and `otherProfileQuery` take
`requireUserId` (additions to feed's `functions.ts`); the photo route needs
a session, and nothing else (signed links were dropped, D-69). Per the owner's clarification (decision D-58), "public" means
visible to signed-in runners: there is no crawler exception, and link
previews use only the site-wide generic card.

**Bans (SAF-4).** A Better Auth plugin in `safety/ban-gate.ts` adds a
`session.create.before` hook, so no sign-in path makes a session for a
banned runner. The refusal reaches the browser in two shapes: the email
form gets a 403 JSON body carrying `ACCOUNT_CLOSED`, the reason and
`closedAt`; Google's callback turns the same error into a 302 to the
error callback, `/auth/login?error=ACCOUNT_CLOSED&error_description=<reason>`
(no date — Better Auth's redirect carries only a code and a description).
Both are tested through the real handlers (`test/safety/ban-gate.test.ts`).
It is wired as one more entry in `auth/instance.ts`'s `plugins` (125's file,
an addition). Content leaves every read through the rule above. D4's notice
is `safety/components/AccountClosed.tsx`, exported and mounted nowhere yet:
putting it on screen for either shape is 126's sign-in form.

**Deletion (SAF-3).** `feed/retract.ts` (entry, entry photo) and
`runs/delete-run.ts` (run → its entry → its photos, plus its import file).
Owner-scoped reads first, then one `db.batch()` of every row delete, open
review rows settled as `removed`, and an outbox row; then the fast path.
New outbox kinds (law 9, additive): `entry_media_delete {userId, entryId}`
reconciles `entries/{userId}/{entryId}/` against the rows that still name
an object — the garment pattern — and `import_file_delete {userId, key}`.
Deleting a run takes its entry with it (the product default). Every
primitive takes a list of ids, so 126's account deletion calls them once.

**Photos (SAF-1/2).** Every stored photo is Photon-decoded and re-encoded
(JPEG for entries, WebP sizes plus a re-encoded original for garments), so
no metadata survives. Before decoding, `lib/photo-pipeline.ts` reads the
dimensions from the JPEG/PNG/WebP header and refuses anything over 16 MP.
In the browser, W3's canvas step always runs — blur off too — and caps the
long edge at 2048px.

**PR 2 split.** 2a is moderation (SAF-5, 6, 8, 10, 15, the
Desk's Runners page); 2b is the closet (SAF-16–19) and SAF-11.

**Signed photos (SAF-7): dropped (owner, 2026-09-28; decision D-69).**
Cloudflare's CSAM tool scans only what its cache serves, and a response a
Worker builds never enters that cache, so signed links bought no scanning.
Photos stay `private` behind sign-in; CSAM coverage for public content is
an open item in the deployment plan's §8.

**Moderation (SAF-5, 6, 8).** `feed/moderation.ts`, because the deletion
statements are feed's and the arrow runs feed → safety. One batch holds
retract's statements, the `moderation_actions` row, and for a Remove or
takedown the author's `content_removed` bell row and email (an
`emailDebt` through `modules/email`), then retract's outbox debt. A
repeat takedown answers `already_removed` and writes nothing.
**Quarantine is silent** (D-70): no bell row, no email. It copies each
object to `quarantine/<key>` and reads the rows before the batch, which
deletes them and writes them to `quarantined_content` (admin-only, kept a
year). Only the admin reviewer route serves that prefix. Bans, unbans and
D8's force-rename write audit rows too. The force-rename is account's
`forceRename` (usernameSchema, the reserved list, D-56), which locks the
old handle in `username_history.locked_at` so nobody may take it, its
former holder included, and sets `user_profiles.username_reset_reason`,
which 126's O0 screen reads. D8's list is account's `listAccounts` and
runs' `runCountsOf`, wired in the server function, because safety cannot
import account (account → ops → safety).

## Contract touches

- Schema: PR 2 only, all additive: `0033_add_moderation_actions`,
  `0034_add_username_reset_reason`, `0035_add_username_history_locked_at`,
  `0036_add_quarantined_content`. No other change; `moderation_status` already has
  `removed`.
- Routes: none in PR 1 — D4 is a component 126's sign-in form mounts, not a
  route; PR 2 adds the Desk pages.
- Bindings/queues/crons: **none**. Outbox kinds ride the daily drain.
- Secrets: none (`PHOTO_URL_SECRET` went with SAF-7, D-69).

## Test plan

Worker: visibility (ban, block both ways, reporter-only hide, counts
unchanged); sign-in refused for a banned runner and restored on unban;
signed-out refusals; each delete removes rows and R2 objects, refuses
another runner, and a failed R2 delete is retried by the drain; EXIF gone
from a GPS fixture (entry blur-off and garment original); an oversized
header refused without decoding. ui: the retract controls. browser: the
2048px downscale.

## Open questions (building to the bracketed default)

1. A runner deleting an entry under review: [allowed; the open review row
   is settled `removed` by the author]. Quarantined photos are out of the
   runner's reach because the quarantine copy has no row.
   **Answered (owner, 2026-09-27; decision D-59): allowed, as built.**
   The server's 16 MP pixel cap (SAF-2) is accepted too (decision D-60).
2. SAF-7 purge: moot — no photo is cached (D-69).
