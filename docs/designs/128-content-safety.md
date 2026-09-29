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

## PR 2b: the closet, W3's blur cells, and the quarantine purge

**Scope.** SAF-16–19 (round 26 #3, #4, #9, #10), SAF-11 as redrawn by
round 27 #27 (and #29's "Photo not added" body, the same file), and the
one-year purge of `quarantined_content`.

**Already done, checked against main (31a0375).** The two email hookups
this lane owed are in: a ban owes `account_closed` (`safety/bans.ts`) and a
Remove or takedown owes `content_removed` (`feed/moderation.ts`), each an
`emailDebt` through `modules/email`, never the binding. W3's counts are
digits already (`blurSummary`). Nothing to build for either.

**SAF-16 · Delete a garment that has runs.** A piece with runs gets round
26's sheet instead of the plain confirm (`closet/components/DeleteWithRuns.tsx`,
built on `ui/Sheet` because `ConfirmSheet` has one primary and this has
two): "Delete the {name}? Retire it instead.", "It's on {n} runs. …", the
`IF YOU DELETE IT` rows, pink **Retire it**, hairline **Delete it and its
record**, Cancel (focused, as Keep it is). Retire it runs the existing
retire; Delete runs the existing `deleteItem` with no second confirm, lands
on C, and C says "{name} deleted." (a one-shot `deleted` search value the
grid reads into its status region). Failure keeps the sheet open under the
`Not deleted` band. **"{b} bands"** is the number of 5 °C bands the piece
has a verdicted run in — the unit A3's band record uses — and it needs the
cross-database walk feed already owns (`observationsForEntries`,
`judgedFeelsLikeC`). Closet may not import feed (the arrow is feed →
closet), so the count is a new feed export, `garmentBandCount`, in a new
file (`feed/garment-bands.ts`) with a server function beside feed's
others, and the garment route passes it down. A piece with no runs keeps
round 22's plain confirm. **Retire, don't delete** is honoured by the
sheet's shape: retiring is the primary, and deleting keeps every entry and
verdict (the owner's task-122 ruling that delete stays available).

**SAF-17 · Saved, photo refused.** When the save lands and the photo does
not, F stops being a form: the fields go, the kicker reads
`SAVED TO CLOSET · {CATEGORY}`, the heading is the piece's name, the well
is empty, and a §4a band under it says `PHOTO NOT ADDED` · "Garment saved,
photo didn't. Try again?" plus the reason. The reason is the server's
refusal sentence for a type or size refusal (`{ ok: false }`), and the
cause line (`classifyFailure`) for a throw. **Try again** shows only when
`classifyFailure` says `network`, and re-sends the held file; **Pick
another** is always there (a file input, as Replace is) and sends the new
photo through W3's step straight to the saved row. The action becomes
**Done**, to Y. A photo that lands from this state goes to Y too. The band
is composed in closet from `Mono` and the band's classes: `ui`'s
`FailureBand` has one button and no reason line, and `ui/` is not ours to
change (named in the PR).

**SAF-18 · F at the desk.** `GarmentForm` takes the runner's closet as
`nearby` and, when given it (the add form only), renders inside
`DeskSplit` with one `RailCard`: "Already in your closet · {CATEGORY}" —
up to five, newest first, retired included and marked `RETIRED`, a
brand+name match with what is typed marked `SAME NAME` (normalised as
products normalise), read-only, unlinked. Each row: a 48px photo or the
photo ground, the label, and a mono record line (`{n} RUNS · {d}/{v}
DIALED {range}`, `… · RETIRED {MON YYYY}`, or `… · NO VERDICT YET`).
Empty: "No {tops} yet.". The read is one `db.batch()` of one
`WHERE user_id = ? AND category = ? ORDER BY created_at DESC LIMIT 5` per
category (index `wardrobe_user_category`), plus the performance summary
`listItems` already computes. **Two differences from the board, both
deltas:** F asks no garment type (the schema comment records why), so the
card matches and is titled by category alone, and the empty line says
"No tops yet." rather than "No half-zips yet."; and F's category is a
select that always holds one, so the "no card before a category" state
never occurs.

**SAF-19 · Closet confirms.** The switch reads "Show retired (4)" and is
still absent at 0. F and Edit gain the way back, `<Icon name="back">`
Closet, as garment detail has it.

**SAF-11 · W3's blur cells (round 27 #27).** `BlurCells` becomes a 3 × 3
grid of 44px square cells (`radius-tight`, 1px ink border), each named
"Blur {position}" and `aria-pressed`; a pressed cell is ink with the pack's
`check` in ground. Focusing a cell outlines its ninth of the photo: a 3 × 3
overlay on the canvas, `aria-hidden`, with a 2px hi-viz outline on the
focused ninth. Round 27 #29's body replaces REDRAW_FAILED's message.

**Quarantine purge (D-69/D-70: silent, a year).** Rides the daily-digest
firing as upkeep, beside `pruneStravaIds` — no new cron (`wrangler.jsonc`
is not ours). `safety/quarantine.ts · purgeExpiredQuarantine`:

1. Read up to 50 rows with `retain_until <= now`, oldest first
   (`quarantined_content_retain`).
2. **Claim** each by compare-and-swap on the `retain_until` it read,
   moving it a day on (`RETURNING`), in one batch: an overlapping run read
   the same value, finds it moved, and claims nothing (law 2). Retention
   is only ever lengthened, so no evidence goes early.
3. **Work** each claimed row: delete its copies from R2 — the
   `preservedKey`s its `photos_snapshot` names (zod-parsed; only keys under
   `quarantine/`) — then delete the row.

**Law 8c: reconciliation, not an outbox.** The row is the durable marker
that bytes are owed a delete, and the daily firing re-drives it: an R2
failure leaves the row, due again when its lease passes; a Worker that
dies between the R2 delete and the row delete leaves a row whose keys are
already gone, and the re-run's delete is a no-op. Keys are named, never
listed by prefix, because two records can share an entry's prefix (a
photo quarantined, then the rest of the entry) and must expire apart.
Failures, and a snapshot that will not parse, go to Sentry with the row id
(law 6/7); nobody else is told (silent, D-70). The `moderation_actions`
audit row stays: it holds who, when and why, not the content.

### Not built, and not in 2b

- **SAF-15, second half (seam 7):** report does not yet open 126's
  "Confirm your email first" sheet for an unverified runner. 126's
  `isVerified` and `ConfirmEmailSheet` are on main now.
- **Round 27 #31, the closet tile's photo** (4:5, full width, the hatch
  without one; "Build: 128 (ClosetGrid)"). Not a SAF item; reported.
- **Conformance for round 26's closet frames** ships with this PR for the
  frames' text and parts; see the specs for the named gaps.

### Contract touches (2b)

- Schema: none. Migrations: none.
- Bindings/queues/crons: none; the purge rides `daily-digest`.
- New cross-module edge: none — the closet route composes feed's count.

### As built (2b)

- **SAF-16.** `DeleteWithRuns` is its own sheet on `ui/Sheet` (not a change
  to `ConfirmSheet`, which is not this lane's). A piece with no runs never
  mounts it. A band row with 0 bands is left out.
- **SAF-17** applies to Edit as well as F: the component does not branch on
  which one it is. `updateSaved` is gone — with the fields gone there is no
  second submit to update. The rail does not yet list the piece the save
  just made (the loader's rows predate it); the board says it should.
- **SAF-18/19.** F's heading and "← Closet" moved from the routes into the
  form, so the saved state can replace the heading with the piece's name;
  the way back is `closet/components/BackToCloset`, shared with Y.
- **Found, not fixed: W3's cells can hardly be used.** Every photo step's
  host (`usePhotoPick` here, `AttachKit` in 127's lane) closes the step on
  the first `onReady`, and `PhotoBlur` calls `onReady` as soon as the
  detector's blur is painted. So the canvas, tap-to-blur and the keyboard
  cells are on screen for a moment, not until the runner is done. Keeping
  the step open needs a "use this photo" moment the W3 board would have to
  say how to draw; it is a question for the owner, not a 2b change.
