/**
 * The only sender (seam 2 of docs/tasks/125-129): every email the app
 * sends goes through `deliverEmail`, and only this module holds the
 * `EMAIL` binding.
 */
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

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
  The secret the unsubscribe link is signed with.
  */
  readonly secret: string;
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
    BETTER_AUTH_SECRET: string;
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
    secret: bindings.BETTER_AUTH_SECRET,
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
 * Render and send one email. `"skipped"` when there was nothing to send —
 * the runner is gone, or they do not want this kind — and a throw when the
 * send failed, so the outbox keeps the row and a caller sending now can
 * say so.
 *
 * An optional email carries `List-Unsubscribe` with one-click (RFC 8058):
 * a mail client's own unsubscribe button POSTs the same signed link.
 */
export async function deliverEmail(
  db: Db,
  payload: EmailPayload,
  deps: EmailDeps = emailDepsFromEnv(),
): Promise<"sent" | "skipped"> {
  const recipient = await recipientOf(db, payload.to);
  if (recipient === undefined) return "skipped";
  const optional = await optionalMail(db, recipient, payload, deps);
  if (optional === "skip") return "skipped";
  const { unsubscribe } = optional;
  const email = renderEmail(payload.template, {
    origin: deps.origin,
    unsubscribe,
  });
  await deps.send({
    from: EMAIL_FROM,
    to: recipient.address,
    subject: email.subject,
    html: email.html,
    text: email.text,
    ...(unsubscribe !== undefined && {
      headers: {
        "List-Unsubscribe": `<${unsubscribe}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });
  return "sent";
}
