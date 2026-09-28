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
 * Round 26 #11's "Email verify": the link that confirms the address. Sent
 * now, never through the outbox — it carries a live token.
 */
const verifyEmail = z.object({ kind: z.literal("verify_email"), url: link });

/**
 * Round 26 #11's "Email existing account": what a sign-up for a
 * registered address sends instead, so the page can say the same thing
 * whoever typed it.
 */
const existingAccount = z.object({ kind: z.literal("existing_account") });

/**
ACC-4: the link that sets a new password. Sent now, like `verify_email`.
*/
const resetPassword = z.object({
  kind: z.literal("reset_password"),
  url: link,
});

/**
 * ACC-8: the link that moves the account to a new address, sent to that
 * new address — confirming it is how the runner proves they hold it.
 */
const emailChange = z.object({
  kind: z.literal("email_change"),
  url: link,
  newEmail: address,
});

/**
 * ACC-8: the notice to the old address once the change is done, so a
 * change the runner did not make is seen by the one inbox that can say
 * so. Secondary to the change, so it rides the outbox.
 */
const emailChanged = z.object({
  kind: z.literal("email_changed"),
  newEmail: address,
});

/**
 * Round 26 #19: the Strava run reminder — the one optional email. What
 * the sender knows is when the run landed, already in the runner's own
 * time ("6:58 AM"), and how many runs the one-a-day email is counting.
 */
const runReminder = z.object({
  kind: z.literal("run_reminder"),
  landedAt: z.string().min(1),
  runs: z.int().min(1),
});

/**
 * Round 27 #15/#20's "Email content removed": a moderator's Remove or a
 * copyright takedown (task 128 · SAF-8), telling the author what went and
 * the reason from the removal list, word for word. Account mail, so always
 * sent. A suspected-CSAM quarantine sends nothing (decision D-70).
 */
const contentRemoved = z.object({
  kind: z.literal("content_removed"),
  subject: z.enum(["entry", "photo"]),
  reason: z.string().min(1),
});

export const emailTemplateSchema = z.discriminatedUnion("kind", [
  verifyEmail,
  existingAccount,
  resetPassword,
  emailChange,
  emailChanged,
  runReminder,
  contentRemoved,
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
