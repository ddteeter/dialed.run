# Design: 138 Strava erasure, the password lockout and the rename guard

> Lane F of `docs/launch/before-public-plan.md` (tasks 126 and 127), plus
> R-121 added by the owner. One PR, one commit per item.

## Problem

Three small gaps before friends use the app. A dead-lettered Strava
reminder's Gave up row keeps the athlete's Strava ids after they disconnect
or leave (R-142). Change password calls Better Auth from the browser, so
the per-runner lockout and round 28 #10's "That's 5 wrong tries" frame never
reach it (R-124, D-98). Two force-renames racing from one handle both write,
and the later one silently replaces the first (R-121).

## Approach

- **R-142.** `gaveUpClearPrefix` in `src/db/gave-up.ts` (not a `schema*`
  file) deletes a kind's rows whose subject starts with a prefix. It uses a
  range on the `(kind, subject_id)` index rather than `LIKE`.
  `reminderSubjectPrefix` in `runs/queue-messages.ts` builds the athlete's
  prefix with `reminderSubject`'s own encoder. The delete goes inside
  `deauthorizeAthlete`'s batch and `disconnectStrava`'s batch. The purge
  calls `disconnectStrava`, so the purge is covered too.
  `processed_webhook_events` has no athlete column, so its seven-day prune
  stays its only cleanup.
- **R-124.** `auth/change-password.ts` adds `changeOwnPassword`. It runs
  `checkOwnPassword` first (the count, then Better Auth's check). Only for
  the runner's own password does it call `auth.api.changePassword`. That
  call is server-side: the breach screen's before-hook still runs, and
  `tanstackStartCookies` sets the new session's cookie. The function
  returns `changed | wrong | limited | breached`. `changeCredentialFn` in
  `auth/functions.ts` is glue. The route passes it to `ChangePassword`,
  which maps each status to a field message the way `ChangeEmail` does.
  The browser-side `changePassword` in `credentials.ts` is deleted.
  D-98 accepted that the password is checked twice.
- **R-121.** `forceRename`'s batch is guarded by "the profile still holds
  `previous`". The history upsert and the clean-up delete check it inside
  their own statements, and so does the audit row
  (`moderationActionInsertWhere`). The profile update runs last, keyed on
  `user_id` and `username = previous`. A rename that lost the race writes
  nothing. Like any repeat (law 8b), it answers with the handle the
  profile now holds.

## Contract touches

- Schema changes needed: **none** (`password_attempts` already holds the
  count; `gave_up` already has the index).
- New route files: none. `routes/account/$section.tsx` wires the new
  server function.
- New bindings/queues/crons: **none**.
- Screens: ACC-7's Change password now shows round 28 #10's drawn
  `currentPasswordLimited` field message. No undesigned surface.

## Test plan

- Worker: `gaveUpClearPrefix` ends, kind and the empty prefix, plus the
  plan uses the index. A deauthorize, a disconnect and a purge each leave no
  row for the athlete and leave a neighbour id's rows alone.
- Worker: `changeOwnPassword` changes the password under the limit. At the
  limit it refuses before the provider is called. A success resets the
  count. A wrong or breached password lands on its own field.
- UI: `ChangePassword` shows the limited sentence, and the wrong and
  breached messages, on their fields.
- Architecture: no source under `src/` calls `authClient.changePassword`;
  `changeCredentialFn` has a row in `verification-class` (`unconfirmed`).
- Worker: two renames racing from one handle leave the first intact, with
  one history row and one audit row.

## Open questions

- Should the CPU cost of the double password check (D-98) be measured on
  the deployed Worker before public?
