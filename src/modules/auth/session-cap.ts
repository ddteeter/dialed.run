/**
 * What a session row keeps (owner, 2026-11-21):
 *
 * - **Its User-Agent, cut to `USER_AGENT_MAX` characters.** A browser's
 *   is far shorter; the rest is never read.
 * - **At most `LIVE_SESSIONS_MAX` per account.** A sign-in past that ends
 *   the account's oldest sessions, so the new one is always kept.
 *
 * Both run as `createAuth`'s session hooks, so every way of signing in
 * (email, Google) is held to them.
 */
import { and, desc, eq, ne, notInArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { session } from "../../db/schema-auth";

type Db = ReturnType<typeof drizzle>;

export const USER_AGENT_MAX = 512;

export const LIVE_SESSIONS_MAX = 50;

/**
 * The before-create hook: the User-Agent cut to its length, or nothing to
 * change.
 */
export function cutUserAgent(row: {
  userAgent?: string | null | undefined;
}): { data: { userAgent: string } } | undefined {
  const { userAgent } = row;
  return typeof userAgent !== "string" || userAgent.length <= USER_AGENT_MAX ? undefined : { data: { userAgent: userAgent.slice(0, USER_AGENT_MAX) } };
}

/**
 * The after-create hook: delete every session of the account but the new
 * one and the `LIVE_SESSIONS_MAX - 1` newest others. One statement, read
 * through `session_user_id`.
 */
export async function endOldestSessions(
  db: Db,
  created: { id: string; userId: string },
): Promise<void> {
  const others = and(
    eq(session.userId, created.userId),
    ne(session.id, created.id),
  );
  const newestOthers = db
    .select({ id: session.id })
    .from(session)
    .where(others)
    .orderBy(desc(session.createdAt), desc(session.id))
    .limit(LIVE_SESSIONS_MAX - 1);
  await db
    .delete(session)
    .where(and(others, notInArray(session.id, newestOthers)));
}
