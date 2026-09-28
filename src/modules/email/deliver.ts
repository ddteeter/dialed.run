/**
 * The only sender (seam 2 of docs/tasks/125-129): every email the app
 * sends goes through `deliverEmail`, and only this module holds the
 * `EMAIL` binding.
 */
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { user } from "../../db/schema-auth";
import { env } from "../../env";
import {
  preferenceFor,
  type EmailPayload,
  type EmailRecipient,
} from "../../lib/email";
import { isEmailWanted } from "./preferences";
import { renderEmail } from "./render";
import { unsubscribeUrl } from "./unsubscribe";

type Db = ReturnType<typeof drizzle>;

/**
 * Who every email is from — round 26's "FROM dialed.run
 * <hello@dialed.run>". The address's domain has to be onboarded to
 * Cloudflare Email Sending before anything leaves (the deployment plan's).
 */
export const EMAIL_FROM = { name: "dialed.run", email: "hello@dialed.run" };

/**
 * What sending needs from the platform, as one parameter so a test hands
 * in a fake binding and an origin rather than reaching the real ones.
 */
export interface EmailDeps {
  readonly send: (message: EmailMessageBuilder) => Promise<unknown>;
  /**
  The app's public origin, which every link in an email starts with.
  */
  readonly origin: string;
  /**
   * The secret the unsubscribe link is signed with (`UNSUBSCRIBE_SECRET`).
   * Absent, no link can be built, so no optional email goes.
   */
  readonly secret: string | undefined;
}

/**
 * The real binding and vars. `bindings` is a parameter so the one decision
 * here — no origin, no send — can be tested; a test cannot unset a var
 * inside the isolate.
 */
export function emailDepsFromEnv(
  bindings: Readonly<{
    EMAIL: { send: EmailDeps["send"] };
    BETTER_AUTH_URL?: string | undefined;
    UNSUBSCRIBE_SECRET?: string | undefined;
  }> = env,
): EmailDeps {
  const origin = bindings.BETTER_AUTH_URL;
  // A link with no origin goes nowhere; better to fail the send, which
  // is reported and retried, than to mail a runner a relative URL.
  // `/api/health` names the missing var too.
  if (origin === undefined) throw new Error("BETTER_AUTH_URL is not set");
  return {
    send: (message) => bindings.EMAIL.send(message),
    origin,
    secret: bindings.UNSUBSCRIBE_SECRET,
  };
}

/**
 * Where an email goes. A runner is looked up now rather than when the
 * email was owed, so an address changed in between is the one written to.
 * `isVerified` is the discriminant: only a confirmed runner carries the id
 * optional mail needs.
 */
type Recipient =
  | {
      readonly isVerified: true;
      readonly userId: string;
      readonly address: string;
    }
  | { readonly isVerified: false; readonly address: string };

async function recipientOf(
  db: Db,
  to: EmailRecipient,
): Promise<Recipient | undefined> {
  if ("address" in to) return { isVerified: false, address: to.address };
  const [row] = await db
    .select({ email: user.email, isVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, to.userId))
    .limit(1);
  if (row === undefined) return undefined;
  return row.isVerified
    ? { isVerified: true, userId: to.userId, address: row.email }
    : { isVerified: false, address: row.email };
}

/**
 * The unsubscribe link for an optional email (none for a transactional
 * one), or `"skip"` when the optional email must not go.
 *
 * Optional mail goes only to a runner with a confirmed address who has not
 * switched it off: an unconfirmed address may not be theirs (round 26 #11
 * — "anything that trusts the address waits").
 */
async function optionalMail(
  db: Db,
  recipient: Recipient,
  payload: EmailPayload,
  deps: EmailDeps,
): Promise<"skip" | { readonly unsubscribe?: string }> {
  // `{}` rather than `{ unsubscribe: undefined }`: the caller only ever
  // destructures the key, and the two are indistinguishable at every read —
  // an explicit `undefined` value here was a mutant no input could kill.
  const preference = preferenceFor(payload.template.kind);
  if (preference === undefined) return {};
  if (!recipient.isVerified) return "skip";
  // No secret, no link — and optional mail without its unsubscribe link
  // does not go (fail closed; `/api/health` names the secret).
  if (deps.secret === undefined || deps.secret === "") return "skip";
  if (!(await isEmailWanted(db, recipient.userId, preference))) return "skip";
  return {
    unsubscribe: await unsubscribeUrl(
      deps.origin,
      deps.secret,
      recipient.userId,
      preference,
    ),
  };
}

/**
 * The left half of a msg-id (RFC 5322 §3.6.4, `dot-atom-text`): letters,
 * digits and the atext symbols, in dot-separated runs.
 */
const DOT_ATOM = /^[\w!#$%&'*+/=?^`{|}~-]+(?:\.[\w!#$%&'*+/=?^`{|}~-]+)*$/u;

/**
 * The `Message-ID` an owed email carries, the same on every attempt: made
 * from its outbox dedupe key, so a send retried after a Worker died
 * between the send and the row's delete reaches the inbox with the id the
 * first one had, and Gmail and others show one message. Cloudflare's
 * sender has no idempotency key of its own. A key that is not already a
 * valid id-left is hashed — deterministically, so the same debt still
 * builds the same header.
 */
export async function messageIdFor(dedupeKey: string): Promise<string> {
  if (DOT_ATOM.test(dedupeKey)) return `<${dedupeKey}@dialed.run>`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(dedupeKey),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `<${hex}@dialed.run>`;
}

/**
 * The sender's answer, as far as anything here reads it. The binding
 * types it; a fake or a future binding may not, so it is parsed.
 */
const sendResultSchema = z.object({ messageId: z.string() });

type Sent =
  | { readonly status: "sent"; readonly messageId: string | undefined }
  | { readonly status: "skipped" };

async function send(
  db: Db,
  payload: EmailPayload,
  deps: EmailDeps,
  extraHeaders: Readonly<Record<string, string>>,
): Promise<Sent> {
  const recipient = await recipientOf(db, payload.to);
  if (recipient === undefined) return { status: "skipped" };
  const optional = await optionalMail(db, recipient, payload, deps);
  if (optional === "skip") return { status: "skipped" };
  const { unsubscribe } = optional;
  const email = renderEmail(payload.template, {
    origin: deps.origin,
    unsubscribe,
  });
  const headers: Record<string, string> = {
    ...extraHeaders,
    ...(unsubscribe !== undefined && {
      "List-Unsubscribe": `<${unsubscribe}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }),
  };
  const result = sendResultSchema.safeParse(
    await deps.send({
      from: EMAIL_FROM,
      to: recipient.address,
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(Object.keys(headers).length > 0 && { headers }),
    }),
  );
  return {
    status: "sent",
    messageId: result.success ? result.data.messageId : undefined,
  };
}

/**
 * Render and send one email. `"skipped"` when there was nothing to send —
 * the runner is gone, or they do not want this kind — and a throw when the
 * send failed, so a caller sending now can say so.
 *
 * An optional email carries `List-Unsubscribe` with one-click (RFC 8058):
 * a mail client's own unsubscribe button POSTs the same signed link.
 */
export async function deliverEmail(
  db: Db,
  payload: EmailPayload,
  deps: EmailDeps = emailDepsFromEnv(),
): Promise<"sent" | "skipped"> {
  const sent = await send(db, payload, deps, {});
  return sent.status;
}

/**
 * An owed email (the outbox's): sent with the debt's own `Message-ID`, and
 * answering the sender's `messageId`, which the outbox records on the row
 * before deleting it.
 */
export async function deliverOwedEmail(
  db: Db,
  payload: EmailPayload,
  dedupeKey: string,
  deps: EmailDeps = emailDepsFromEnv(),
): Promise<Sent> {
  return send(db, payload, deps, {
    "Message-ID": await messageIdFor(dedupeKey),
  });
}
