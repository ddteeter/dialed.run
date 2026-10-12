# Design: 141 Lane D2 · takedown follow-ups (R-140, R-145 c)

## Problem

A copyright takedown's band says "We removed this photo after a copyright
notice.", but the bell row and email still give the moderator's reason
("it uses someone else's work"): round 27 #20 wants one sentence in all
three (R-140). And D-117 promised that a Review row about an intimate image
lists the same runner's other photos, as the reasonable effort on copies
the TAKE IT DOWN Act asks for (R-145 c). Neither is built.

## Approach

**Checked on main first.** `takedownSentence` and `ContentRemoved`'s
`action` exist (design PR A); the barrel exports neither the sentence nor a
chooser, the email has no takedown variant, `feed/moderation.ts`' `notice`
ignores `action`, and `ContentRemoved` is mounted nowhere.

**A takedown is not always a copyright notice.** #169 made Review's
removal requests take a subject down with `action: "takedown"` and reason
`intimate`. Passing `action` through as R-140 words it would tell the
author of an intimate image that it went "after a copyright notice". So
the takedown sentence is chosen by `action` _and_ reason:

- `safety/contracts.ts`: `isCopyrightTakedown(action, reason)` and
  `removalNotice(subjectType, action, reason)`, the one chooser.
  `ContentRemoved` uses it, which fixes the same bug in the band.
- The barrel exports both (not `takedownSentence` itself, which only the
  chooser calls; knip would flag a barrel export nobody reads).
- `email-kinds.ts`' `content_removed` gains an optional
  `cause: "copyright_notice"` (optional: law 9, the outbox holds old rows).
  `email/content.ts` writes "We removed a photo from one of your runs
  after a copyright notice. Your run and verdict stay." for it.
- `feed/moderation.ts`' `notice` takes `input.action`: the bell body is
  `removalNotice(...)`, the email carries `notice` when it is one.

**Other photos (R-145 c).** `safety/other-photos.ts`:
`otherPhotosOf(db, subjects)` reads, per subject, one batch of selects:
the runner's other entry photos, newest kit first, at most 12. The owner
is a subquery on the subject (a photo's entry, or the entry); the subject
itself is excluded in SQL (that photo, or that kit's photos), and so is a
kit whose `moderation_status` is `removed` (removal deletes today; this
keeps a legacy row out). Served by `entries_user_created` and
`entry_photos_idempotency`'s `entry_id` prefix: no new index, no migration.
`pendingReviewQueue` attaches them to rows with a removal clock (an
`intimate` report) and `pendingTakedownRequests` to requests whose link is
ours. `components/OtherPhotos.tsx` renders them on both rows: thumbnails
from `/safety/review-photo/`, each linking to its kit, with its id for the
takedown form. No new server function.

## Contract touches

- Schema changes needed: **none**.
- New route files: none. New bindings/queues/crons: **none**.
- Email wire format: `content_removed` gains an optional field (additive).
- Design deltas (item 63, after #186's 62): the other-photos block on both Review rows; the
  takedown email's sentence; W1's undrawn link to `/takedown`.

## Test plan

- `test/safety/moderation-actions.test.ts`: `removalNotice` for remove, copyright
  takedown, intimate takedown, entry and photo.
- `test/safety/notice-band.dom.test.tsx`: an intimate takedown's band.
- `test/email/render.test.ts` + `test/lib/email.test.ts`: the takedown
  email's body, and an old row without `notice` still parses.
- `test/safety/moderation-actions.test.ts` (worker): the bell row and email
  per action and reason.
- `test/safety/other-photos.test.ts` (worker): scope, exclusions, order,
  limit, and EXPLAIN (no scan of `outfit_entries` or `entry_photos`).
- `test/safety/other-photos.dom.test.tsx`: the block alone and on both rows.
- e2e: `e2e/safety/takedown.demo.spec.ts` (which owns Review's removal requests) re-recorded with the other photos.

## Open questions

- **Mounting `ContentRemoved` on the author's run needs a column.** A
  Remove deletes the photo or entry, and `moderation_actions` keeps the
  subject's id but not its entry or run, so nothing can find "where the
  thing was". An additive nullable `entry_id` (and `run_id`) on
  `moderation_actions`, written by `moderateContent`, would do it. Not
  built: this lane's brief allowed only an index migration. Asked of the
  owner in the PR; R-140 stays open for that half.
