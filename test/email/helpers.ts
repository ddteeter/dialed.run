import { drizzle } from "drizzle-orm/d1";

import { user } from "../../src/db/schema-auth";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import type { OwedMail } from "../../src/modules/account/verification";
import type { EmailDeps } from "../../src/modules/email";
import { settleOutbox } from "../../src/modules/ops/outbox";
import {
  emailHandler,
  outboxHandlers,
} from "../../src/modules/ops/outbox-handlers";

export const ORIGIN = "https://dialed.test";
/**
Not a secret: signs unsubscribe links in a throwaway isolate.
*/
export const SECRET = "test-secret-not-for-production";

export function core() {
  return drizzle(env.DIALED_CORE);
}

/**
 * The headers Cloudflare Email Service sets itself and refuses from a
 * sender with `E_HEADER_NOT_ALLOWED`, copied from
 * developers.cloudflare.com/email-service/reference/headers (read
 * 2026-09-27). `ARC-*` is a prefix. The API-field names (`From`, `To`,
 * `Subject`, …) are refused too, as `E_HEADER_USE_API_FIELD`.
 */
export const CLOUDFLARE_DISALLOWED_HEADERS = [
  "Date",
  "Message-ID",
  "MIME-Version",
  "Content-Type",
  "Content-Transfer-Encoding",
  "DKIM-Signature",
  "Return-Path",
  "Received",
  "Feedback-ID",
  "TLS-Required",
  "TLS-Report-Domain",
  "TLS-Report-Submitter",
  "CFBL-Address",
  "CFBL-Feedback-ID",
] as const;
const CLOUDFLARE_API_FIELD_HEADERS = [
  "From",
  "To",
  "Cc",
  "Bcc",
  "Subject",
  "Reply-To",
] as const;

/**
 * The header names on a message Cloudflare would refuse, compared as the
 * platform does, without regard to case.
 */
export function refusedHeaders(message: EmailMessageBuilder): string[] {
  const refused = new Set<string>(
    [...CLOUDFLARE_DISALLOWED_HEADERS, ...CLOUDFLARE_API_FIELD_HEADERS].map(
      (name) => name.toLowerCase(),
    ),
  );
  return Object.keys(message.headers ?? {}).filter(
    (name) =>
      refused.has(name.toLowerCase()) || name.toLowerCase().startsWith("arc-"),
  );
}

/**
 * The binding, replaced: every message handed to it, in order, and a
 * switch to make the next sends fail as a real outage would. A message
 * carrying a header Cloudflare refuses is refused here too, so every test
 * that sends through this holds the rule.
 */
export function fakeMail(): EmailDeps & {
  sent: EmailMessageBuilder[];
  /**
  The `messageId` each send answered, in order.
  */
  ids: string[];
  failing: (isFailing: boolean) => void;
} {
  const sent: EmailMessageBuilder[] = [];
  const ids: string[] = [];
  let isFailing = false;
  return {
    origin: ORIGIN,
    secret: SECRET,
    sent,
    ids,
    failing: (next) => {
      isFailing = next;
    },
    send: (message) => {
      if (isFailing) return Promise.reject(new Error("send failed"));
      const refused = refusedHeaders(message);
      if (refused.length > 0) {
        return Promise.reject(
          new Error(`E_HEADER_NOT_ALLOWED: ${refused.join(", ")}`),
        );
      }
      sent.push(message);
      const messageId = newUlid();
      ids.push(messageId);
      return Promise.resolve({ messageId });
    },
  };
}

/**
A runner in Better Auth's `user` table, as sign-up leaves one.
*/
export async function seedUser(
  options: Readonly<{ email?: string; isVerified?: boolean }> = {},
): Promise<{ userId: string; email: string }> {
  const userId = newUlid();
  const email = options.email ?? `${userId.toLowerCase()}@example.test`;
  const now = new Date();
  await core()
    .insert(user)
    .values({
      id: userId,
      name: "",
      email,
      emailVerified: options.isVerified ?? true,
      createdAt: now,
      updatedAt: now,
    });
  return { userId, email };
}

/**
 * Where a request's owed email goes after the answer: held until the test
 * lets it go, so a test can look before it is sent and after, and sent
 * through `mail`.
 */
export function owedTo(mail: ReturnType<typeof fakeMail>): {
  owed: OwedMail;
  settled: () => Promise<void>;
} {
  const work: Promise<unknown>[] = [];
  const { promise: gate, resolve: release } =
    Promise.withResolvers<undefined>();
  const handlers = { ...outboxHandlers, email: emailHandler(() => mail) };
  return {
    owed: {
      keepAlive: (promise) => {
        work.push(promise);
      },
      report: quiet,
      settle: async (database, debt, report) => {
        await gate;
        await settleOutbox(database, debt, report, handlers);
      },
    },
    settled: async () => {
      release(undefined);
      await Promise.all(work);
    },
  };
}

export function quiet(): void {
  // these sends succeed, so there is nothing to report
}
