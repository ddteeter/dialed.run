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

import {
  accessConfirm,
  accountClosed,
  accountReopened,
  address,
  contentRemoved,
  deletionScheduled,
  digest,
  removalDue,
  removalReminder,
  removalReminderSummary,
  removalRequestDecided,
  removalRequestReceived,
  removalRequested,
  takedownValve,
  emailChange,
  emailChanged,
  existingAccount,
  exportReady,
  invite,
  resetPassword,
  runReminder,
  stravaDisconnected,
  verifyEmail,
} from "./email-kinds";

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

export const emailTemplateSchema = z.discriminatedUnion("kind", [
  verifyEmail,
  existingAccount,
  resetPassword,
  emailChange,
  emailChanged,
  accessConfirm,
  runReminder,
  contentRemoved,
  accountClosed,
  accountReopened,
  invite,
  stravaDisconnected,
  deletionScheduled,
  digest,
  exportReady,
  removalDue,
  removalRequested,
  removalRequestReceived,
  removalRequestDecided,
  removalReminder,
  removalReminderSummary,
  takedownValve,
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
  access_confirm: undefined,
  email_changed: undefined,
  run_reminder: "run_reminder",
  content_removed: undefined,
  account_closed: undefined,
  account_reopened: undefined,
  invite: undefined,
  strava_disconnected: undefined,
  deletion_scheduled: undefined,
  digest: undefined,
  removal_due: undefined,
  removal_requested: undefined,
  removal_request_received: undefined,
  removal_request_decided: undefined,
  removal_reminder: undefined,
  removal_reminder_summary: undefined,
  takedown_valve: undefined,
  export_ready: undefined,
};

/**
 * Whether an email to a runner waits for their address to be confirmed
 * (SA-M28): a notice of something the runner did that an address they
 * never proved is theirs has no need to hear. Mail to a typed address (an
 * invite, a change link) is not a runner's, and is not held by this.
 *
 * A table over every kind, as `PREFERENCE_OF` is, so a lane adding a kind
 * has to say. The link emails an unconfirmed runner must receive say no;
 * the rest are as they were until the owner rules on each.
 */
const CONFIRMED_ADDRESS_REQUIRED: Readonly<Record<EmailKind, boolean>> = {
  verify_email: false,
  existing_account: false,
  reset_password: false,
  email_change: false,
  access_confirm: false,
  email_changed: false,
  run_reminder: false,
  content_removed: false,
  account_closed: false,
  account_reopened: false,
  invite: false,
  strava_disconnected: true,
  deletion_scheduled: false,
  digest: false,
  removal_due: false,
  removal_requested: false,
  removal_request_received: false,
  removal_request_decided: false,
  removal_reminder: false,
  removal_reminder_summary: false,
  takedown_valve: false,
  export_ready: false,
};

export function requiresConfirmedAddress(kind: EmailKind): boolean {
  return CONFIRMED_ADDRESS_REQUIRED[kind];
}

/**
 * Settings › Notifications' one switch in v1 (ACC-11; round 26 #19): what
 * the switch saves, as the server function parses it. The switch saves as it
 * changes (R54·166.3), so no form reads it.
 */
export const notificationSettingsSchema = z.object({
  runReminder: z.boolean(),
});

export function preferenceFor(
  kind: EmailKind,
): EmailPreferenceKind | undefined {
  return PREFERENCE_OF[kind];
}

export { STRAVA_DISCONNECTED_LINE } from "./email-kinds";
