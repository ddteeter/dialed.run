import { drizzle } from "drizzle-orm/d1";

import { user } from "../../src/db/schema-auth";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import type { EmailDeps } from "../../src/modules/email";

export const ORIGIN = "https://dialed.test";
/**
Not a secret: signs unsubscribe links in a throwaway isolate.
*/
export const SECRET = "test-secret-not-for-production";

export function core() {
  return drizzle(env.DIALED_CORE);
}

/**
 * The binding, replaced: every message handed to it, in order, and a
 * switch to make the next sends fail as a real outage would.
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
