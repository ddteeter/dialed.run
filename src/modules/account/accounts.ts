/**
 * Every account, for the Desk (task 128 · D8, round 27 #22): the one read
 * of `user` beside a runner's own, so the Desk lists accounts through the
 * module that owns them rather than reading Better Auth's table itself.
 *
 * **Sized for the Desk, not the feed.** D8's own header reads 412
 * ACCOUNTS; the list is capped at `ACCOUNTS_PAGE` rows, newest first.
 * Search is a prefix on the handle, which `user_profiles_username_nocase`
 * serves, or on the email. What the Desk adds to each row — runs, reports,
 * whether it is closed — is its own, and so is its filter, which arrives
 * as SQL so it narrows the rows before the `LIMIT` rather than after it.
 */
import { and, desc, eq, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { user } from "../../db/schema-auth";
import { userProfiles } from "../../db/schema-core";

type Db = ReturnType<typeof drizzle>;

export interface AccountRow {
  userId: string;
  username: string | undefined;
  email: string;
  /**
  Epoch seconds.
  */
  joinedAt: number;
}

/**
 * Which accounts to list: a prefix typed into the search box, and a
 * condition on the account's id from the caller (D8's Reported and Closed).
 */
export interface AccountsQuery {
  query?: string | undefined;
  only?: ((userId: typeof user.id) => SQL) | undefined;
}

/**
The most rows one read returns.
*/
export const ACCOUNTS_PAGE = 100;

/**
The `LIKE` pattern for a prefix, with the wildcards in what was typed escaped.
*/
export function prefixPattern(typed: string): string {
  const escaped = typed
    .toLowerCase()
    .replaceAll(/[\\%_]/gu, (wildcard) => `\\${wildcard}`);
  return `${escaped}%`;
}

function matching(query: string | undefined) {
  // An empty query needs no guard of its own: its pattern is `%`, which
  // matches every row, exactly as no filter does.
  if (query === undefined) return;
  const pattern = prefixPattern(query.replace(/^@/u, ""));
  return or(
    sql`${userProfiles.username} LIKE ${pattern} ESCAPE '\\'`,
    sql`LOWER(${user.email}) LIKE ${pattern} ESCAPE '\\'`,
  );
}

export async function listAccounts(
  db: Db,
  { query, only }: AccountsQuery,
): Promise<AccountRow[]> {
  const rows = await db
    .select({
      userId: user.id,
      username: userProfiles.username,
      email: user.email,
      joinedAt: user.createdAt,
    })
    .from(user)
    .leftJoin(userProfiles, eq(userProfiles.userId, user.id))
    .where(and(matching(query), only?.(user.id)))
    .orderBy(desc(user.createdAt))
    .limit(ACCOUNTS_PAGE);
  return rows.map((row) => ({
    userId: row.userId,
    username: row.username ?? undefined,
    email: row.email,
    joinedAt: Math.floor(row.joinedAt.getTime() / 1000),
  }));
}

/**
D8's header count: every account, whatever the filter.
*/
export async function accountCount(db: Db): Promise<number> {
  return db.$count(user);
}
