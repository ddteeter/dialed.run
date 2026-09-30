/**
 * The email wire format (task 126, ACC-2): what an email says, to whom,
 * parsed rather than trusted.
 *
 * A payload crosses a deploy boundary whenever it rides the outbox — one
 * deploy writes the row, a later one (or an older one, after a rollback)
 * sends it — so the rules are a queue message's (law 9): add a kind, never
 * repurpose one; a new field is optional; a kind stops being written
 * before it stops being read. Lanes add their own kinds here, additions
 * only (docs/designs/126-accounts.md publishes the interface).
 *
 * **What a template carries is what it says**, not what the sender looks
 * up: a link, an address, a count. The one lookup is the recipient's
 * address for `{ userId }`, done at send time so a changed address is the
 * one written to.
 */
import { z } from "zod";

/**
 * The emails a runner can switch off, each with a row in
 * `notification_preferences` (decision D-43; round 26 #19). In v1 only the
 * Strava run reminder: every other email is transactional — always sent,
 * with no switch — and nothing commercial is sent at all.
 */
export const EMAIL_PREFERENCE_KINDS = ["run_reminder"] as const;
export const emailPreferenceKindSchema = z.enum(EMAIL_PREFERENCE_KINDS);
export type EmailPreferenceKind = z.infer<typeof emailPreferenceKindSchema>;

/**
 * How many links of one kind an address may be sent in an hour (round 26
 * #11: "That's 5 links this hour."). Here rather than beside the limit so
 * the page that says it and the table that counts it read one number.
 */
export const EMAIL_SENDS_PER_HOUR = 5;

const address = z.email();
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
const verifyEmail = emailKind("verify_email", { url: link });

/**
 * Round 26 #11's "Email existing account": what a sign-up for a
 * registered address sends instead, so the page can say the same thing
 * whoever typed it.
 */
const existingAccount = emailKind("existing_account", {});

/**
ACC-4: the link that sets a new password. Sent now, like `verify_email`.
*/
const resetPassword = emailKind("reset_password", { url: link });

/**
 * ACC-8: the link that moves the account to a new address, sent to that
 * new address — confirming it is how the runner proves they hold it.
 */
const emailChange = emailKind("email_change", {
  url: link,
  newEmail: address,
});

/**
 * ACC-8: the notice to the old address once the change is done, so a
 * change the runner did not make is seen by the one inbox that can say
 * so. Secondary to the change, so it rides the outbox.
 */
const emailChanged = emailKind("email_changed", { newEmail: address });

/**
 * Round 26 #19: the Strava run reminder — the one optional email. What
 * the sender knows is when the run landed, already in the runner's own
 * time ("6:58 AM"), and how many runs the one-a-day email is counting.
 */
const runReminder = emailKind("run_reminder", {
  landedAt: z.string().min(1),
  runs: z.int().min(1),
});

/**
 * Round 27 #15/#20's "Email content removed": a moderator's Remove or a
 * copyright takedown (task 128 · SAF-8), telling the author what went and
 * the reason from the removal list, word for word. Account mail, so always
 * sent. A suspected-CSAM quarantine sends nothing (decision D-70).
 */
const contentRemoved = emailKind("content_removed", {
  subject: z.enum(["entry", "photo"]),
  reason: z.string().min(1),
});

/**
 * Round 27 #15's "Email ban": a moderator closed the account (task 128 ·
 * SAF-4), with the reason the notice quotes. Account mail, so always sent,
 * and no button — there is nothing to log in to.
 */
const accountClosed = emailKind("account_closed", {
  reason: z.string().min(1),
});

/**
 * Round 26 #20's invite (task 126, ACC-5): the code D7's Send invite
 * minted for an access request, and the way in with it filled.
 */
const invite = emailKind("invite", { code: z.string().min(1) });

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
const stravaDisconnected = emailKind("strava_disconnected", {});

/**
 * Round 27 #14's "Email delete scheduled" (task 126, ACC-9): the day the
 * account goes ("Sat, Oct 4"), and the way to keep it.
 */
const deletionScheduled = emailKind("deletion_scheduled", {
  day: z.string().min(1),
});

/**
 * Operator Screens D5, the morning digest (task 125 · OPS-11): the Desk's
 * three numbers, every day, even at zero — so a missing email is a broken
 * pipeline and never a quiet one. `oldestHours` is absent when nothing is
 * waiting.
 */
const digest = emailKind("digest", {
  day: z.string().min(1),
  waiting: z.int().min(0),
  oldestHours: z.int().min(0).optional(),
  screenerUnfinished: z.int().min(0),
  bansThisWeek: z.int().min(0),
});

export const emailTemplateSchema = z.discriminatedUnion("kind", [
  verifyEmail,
  existingAccount,
  resetPassword,
  emailChange,
  emailChanged,
  runReminder,
  contentRemoved,
  accountClosed,
  invite,
  stravaDisconnected,
  deletionScheduled,
  digest,
]);

export type EmailTemplate = z.infer<typeof emailTemplateSchema>;
export type EmailKind = EmailTemplate["kind"];

/**
 * A runner, looked up at send time, or an address as typed — for mail to
 * someone with no account (an invite) or to an address that is not the
 * account's yet (an email change).
 */
export const emailRecipientSchema = z.union([
  z.strictObject({ userId: z.string().min(1) }),
  z.strictObject({ address }),
]);

export type EmailRecipient = z.infer<typeof emailRecipientSchema>;

export const emailPayloadSchema = z.object({
  to: emailRecipientSchema,
  template: emailTemplateSchema,
});

export type EmailPayload = z.infer<typeof emailPayloadSchema>;

/**
 * Which switch governs an email, or `undefined` for a transactional one.
 *
 * A table over every kind rather than a list of the optional ones, so a
 * lane adding a kind has to say which it is: the compiler refuses a kind
 * this does not name.
 */
const PREFERENCE_OF: Readonly<
  Record<EmailKind, EmailPreferenceKind | undefined>
> = {
  verify_email: undefined,
  existing_account: undefined,
  reset_password: undefined,
  email_change: undefined,
  email_changed: undefined,
  run_reminder: "run_reminder",
  content_removed: undefined,
  account_closed: undefined,
  invite: undefined,
  strava_disconnected: undefined,
  deletion_scheduled: undefined,
  digest: undefined,
};

/**
 * Settings › Notifications' one switch in v1 (ACC-11; round 26 #19) — the
 * form's schema and the server function's, here so both sides read one.
 */
export const notificationSettingsSchema = z.object({
  runReminder: z.boolean(),
});

export function preferenceFor(
  kind: EmailKind,
): EmailPreferenceKind | undefined {
  return PREFERENCE_OF[kind];
}
