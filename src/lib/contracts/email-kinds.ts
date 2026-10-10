/**
 * Every email kind `email.ts`'s discriminated union carries — the table of
 * "name plus fields" itself, kept apart from the schema, the preference map
 * and the sender that read it (`./email`).
 *
 * Split out for the same reason `src/db/schema-*.ts` and
 * `modules/closet/tap-list-data.ts` are (CLAUDE.md, `.fallowrc.jsonc`):
 * `emailKind(name, fields)` is a schema DSL, so a run of these declarations
 * reads as a duplicate of any other run regardless of which kind each
 * actually names. Introducing `emailKind` itself already killed one such
 * finding — its own comment below says so — and this file is the rest of
 * the table it was written for: moving the table out lets `.fallowrc.jsonc`
 * ignore it without also blinding itself to `email.ts`'s real behaviour
 * (`preferenceFor`, the recipient and payload schemas).
 */
import { z } from "zod";

import { exportTokenSchema } from "./data-export";

export const address = z.email();
const link = z.url({ protocol: /^https?$/u });

/**
 * One email kind: the literal that names it, plus whatever it carries.
 * Every variant below is this shape and nothing else — factored out because
 * `z.object({ kind: z.literal(k), ...fields })` repeated at every variant is
 * the DSL boilerplate `dupes` finds, not a design each kind actually shares.
 * `Kind` is inferred from the literal passed in, so `emailTemplateSchema`'s
 * discriminated union still narrows on it exactly as if it had been written
 * out by hand.
 */
function emailKind<Kind extends string, Fields extends z.core.$ZodShape>(
  kind: Kind,
  fields: Fields,
) {
  return z.object({ kind: z.literal(kind), ...fields });
}

/**
 * Round 26 #11's "Email verify": the link that confirms the address. Sent
 * now, never through the outbox — it carries a live token.
 */
export const verifyEmail = emailKind("verify_email", { url: link });

/**
 * Round 26 #11's "Email existing account": what a sign-up for a
 * registered address sends instead, so the page can say the same thing
 * whoever typed it.
 */
export const existingAccount = emailKind("existing_account", {});

/**
ACC-4: the link that sets a new password. Sent now, like `verify_email`.
*/
export const resetPassword = emailKind("reset_password", { url: link });

/**
 * ACC-8: the link that moves the account to a new address, sent to that
 * new address — confirming it is how the runner proves they hold it.
 */
export const emailChange = emailKind("email_change", {
  url: link,
  newEmail: address,
});

/**
 * ACC-8: the notice to the old address once the change is done, so a
 * change the runner did not make is seen by the one inbox that can say
 * so. Secondary to the change, so it rides the outbox.
 */
export const emailChanged = emailKind("email_changed", { newEmail: address });

/**
 * Round 26 #19: the Strava run reminder — the one optional email. What
 * the sender knows is when the run landed, already in the runner's own
 * time ("6:58 AM"), and how many runs the one-a-day email is counting.
 */
export const runReminder = emailKind("run_reminder", {
  landedAt: z.string().min(1),
  runs: z.int().min(1),
});

/**
 * Round 27 #15/#20's "Email content removed": a moderator's Remove or a
 * copyright takedown (task 128 · SAF-8), telling the author what went and
 * the reason from the removal list, word for word. Account mail, so always
 * sent. A suspected-CSAM quarantine sends nothing (decision D-70).
 */
export const contentRemoved = emailKind("content_removed", {
  subject: z.enum(["entry", "photo"]),
  reason: z.string().min(1),
});

/**
 * Round 27 #15's "Email ban": a moderator closed the account (task 128 ·
 * SAF-4), with the reason the notice quotes. Account mail, so always sent,
 * and no button — there is nothing to log in to.
 */
export const accountClosed = emailKind("account_closed", {
  reason: z.string().min(1),
});

/**
 * D-89 (round 28 #8): an operator reopened a closed account. Account
 * mail, so always sent: a runner told their account was closed is owed
 * being told it is open again. Round 29 #7 names the account by its
 * handle ("We reopened @maya_runs.").
 *
 * `handle` is **optional, and must stay so** (law 9): an outbox row is a
 * wire format between deploys, and a reopen owed by the build before this
 * one carries no handle. A runner closed before they picked one has none
 * either.
 */
export const accountReopened = emailKind("account_reopened", {
  handle: z.string().min(1).optional(),
});

/**
 * Round 26 #20's invite (task 126, ACC-5): the code D7's Send invite
 * minted for an access request, and the way in with it filled.
 */
export const invite = emailKind("invite", { code: z.string().min(1) });

/**
 * What a deauthorization tells the runner, in the app (S1's row) and by
 * email — one sentence, here where both can read it. Strava's word for
 * what happened rather than the runner's: the event may be forged.
 */
export const STRAVA_DISCONNECTED_LINE =
  "Strava says dialed.run was disconnected, so run reminders have stopped.";

/**
 * Round 27 #19's "Email Strava disconnected" (task 127 · STR-3): a
 * deauthorization arrived, the connection is gone, reminders have
 * stopped. It says nothing else — the event may not be the runner's.
 */
export const stravaDisconnected = emailKind("strava_disconnected", {});

/**
 * Round 27 #14's "Email delete scheduled" (task 126, ACC-9): the day the
 * account goes ("Sat, Oct 4"), and the way to keep it.
 */
export const deletionScheduled = emailKind("deletion_scheduled", {
  day: z.string().min(1),
});

/**
 * Round 27 #13's "Email export" (task 126, ACC-10; D-79): the ZIP is
 * ready, and the link to it — `/account/export/{token}`. The token rides
 * the outbox because it is not a bearer credential: the link opens only
 * for the export's owner, signed in (the board's "only while you're
 * logged in").
 */
export const exportReady = emailKind("export_ready", {
  token: exportTokenSchema,
});

/**
 * Design 136 (D-117): an operator's alert that a report hid something as
 * an intimate image shared without consent, and when its removal is due
 * (`dueAt`, epoch seconds, 48 hours on). Undesigned: placeholder words
 * (design deltas item 58). Operator mail, so always sent.
 */
export const removalDue = emailKind("removal_due", {
  subject: z.enum(["entry", "photo"]),
  dueAt: z.int().min(0),
});

/**
 * Operator Screens D5, the morning digest (task 125 · OPS-11): the Desk's
 * three numbers, every day, even at zero — so a missing email is a broken
 * pipeline and never a quiet one. `oldestHours` is absent when nothing is
 * waiting.
 */
export const digest = emailKind("digest", {
  day: z.string().min(1),
  waiting: z.int().min(0),
  oldestHours: z.int().min(0).optional(),
  screenerUnfinished: z.int().min(0),
  bansThisWeek: z.int().min(0),
  // Jobs the system gave up on (R-119): optional, because a digest owed by
  // the deploy before this one sits in the outbox without it (law 9).
  gaveUp: z.int().min(0).optional(),
});
