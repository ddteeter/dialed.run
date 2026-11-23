/**
 * The handler for an owed email (task 126, ACC-2), and the operators'
 * mail (design 232): `email` sends it, `runs` says whether a Strava
 * reminder is still owed and marks its day, and `safety` mints a removal
 * receipt's confirm token. Its own sub-module (design 256), and not in
 * `ops`' barrel, so the outbox and that barrel import none of the three
 * and `runs` and `safety` can import them.
 */
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { outbox } from "../../../db/schema-core";
import { nowSeconds } from "../../../lib/now";
import type { OutboxMessageOf } from "../../../lib/sql/outbox";
import { captureException } from "../sentry";
import {
  Refused,
  settleOutbox,
  type OutboxDebtOf,
  type OutboxHandler,
  type OutboxHandlers,
} from "../outbox";
import {
  deliverOwedEmail,
  emailDepsFromEnv,
  type EmailDeps,
} from "../../email";
import { isReminderStillOwed, reminderEmailSent } from "../../runs";
import { mintReceiptConfirmToken } from "../../safety";

type Db = ReturnType<typeof drizzle>;

type OwedEmailMessage = OutboxMessageOf<"email">["payload"]["email"];

/**
The dedupe key's kind: its text before the first `:`, or all of it.
*/
function dedupeKindOf(dedupeKey: string): string {
  const end = dedupeKey.indexOf(":");
  return end === -1 ? dedupeKey : dedupeKey.slice(0, end);
}

/**
 * SA-L18: a removal request's receipt is owed with its request, not its
 * confirm token, and the token is minted here, as it is sent
 * (`mintReceiptConfirmToken`). A request no longer waiting on a confirm
 * gets its receipt without the link. Any other email goes as owed.
 */
async function withReceiptConfirmToken(
  db: Db,
  email: OwedEmailMessage,
): Promise<OwedEmailMessage> {
  const { template } = email;
  // Only a receipt has the field; one owed before SA-L18 carries its token
  // instead, and goes as owed.
  if (
    !("confirmRequestId" in template) ||
    template.confirmRequestId === undefined
  ) {
    return email;
  }
  const { confirmRequestId, ...rest } = template;
  const confirmToken = await mintReceiptConfirmToken(db, confirmRequestId);
  return { ...email, template: { ...rest, confirmToken } };
}

/**
 * An owed email (task 126, ACC-2). A send is at-least-once like every
 * handler here, and the sender has no idempotency key (and sets
 * `Message-ID` itself, refusing ours), so the row is marked sent —
 * `sent_at` and the sender's id, in one statement — the moment the send
 * lands. A Worker that dies before the delete leaves a row the drain
 * deletes rather than sends again. What no mark can cover is a Worker
 * that dies between the send and the mark: that email goes twice.
 * `deps` is a parameter so a test hands in a fake sender.
 *
 * A Strava reminder's email (`reminder`) is checked here, when it is due
 * rather than when it was owed — skipped if no reminder from its landing
 * on is still unread, the runner disconnected, or the day's email already
 * went — and its day is marked sent in the same batch as the row (design
 * 140), so neither a re-firing drain nor a second debt for the day can
 * send it again.
 */
export function emailHandler(deps: () => EmailDeps): OutboxHandler<"email"> {
  return {
    run: async (db, payload, rowId) => {
      // A reminder with nothing left to say — answered, disconnected, or
      // the day's already sent — settles like a skipped send: the row
      // goes, nothing is marked.
      const { reminder } = payload;
      if (
        reminder !== undefined &&
        !(await isReminderStillOwed(db, reminder))
      ) {
        return;
      }
      const sent = await deliverOwedEmail(
        db,
        await withReceiptConfirmToken(db, payload.email),
        deps(),
      );
      if (sent.status === "refused") return new Refused(sent.code);
      if (sent.status === "skipped") return;
      const sentAt = nowSeconds();
      // Due at once, too: the drain's one index range then finds a row
      // whose delete never landed, and deletes it rather than sending.
      const markSent = db
        .update(outbox)
        .set({ sentAt, nextAttemptAt: sentAt, messageId: sent.messageId })
        .where(eq(outbox.id, rowId));
      await db.batch([
        markSent,
        ...(reminder === undefined ? [] : [reminderEmailSent(db, reminder)]),
      ]);
    },
    // Ids only (law 7): never the address, which is what a report would
    // otherwise carry, and of the dedupe key only its kind (the text
    // before the first `:`), never the rest. The report's `outboxId`
    // names the row.
    context: (payload) => ({
      dedupeKey: dedupeKindOf(payload.dedupeKey),
      template: payload.email.template.kind,
    }),
  };
}

/**
 * The live handler, sending through the platform's sender: every
 * fast path that settles an email, and both email kinds in the drain.
 */
const owedEmailHandler: OutboxHandler<"email"> = emailHandler(emailDepsFromEnv);

/**
Both email kinds' live handler, keyed for a fast path or the registry.
*/
export const owedEmailHandlers = {
  email: owedEmailHandler,
  // Design 232: the operators' mail, sent as any email is.
  operator_email: owedEmailHandler,
} satisfies Partial<OutboxHandlers>;

/**
 * An owed email's fast path: `settleOutbox` with the live handler. What a
 * module that owes a runner's email hands its `settle` (`OwedMail`), and
 * the operators' digest its own (`operator_email`).
 */
export function settleOwedEmail(
  db: Db,
  debt: OutboxDebtOf<"email"> | OutboxDebtOf<"operator_email">,
  report: typeof captureException = captureException,
): Promise<void> {
  return settleOutbox(db, debt, owedEmailHandlers, report);
}
