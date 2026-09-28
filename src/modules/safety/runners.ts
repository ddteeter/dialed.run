/**
 * Desk · Runners, "D8" (round 27 #22): every account, searchable by handle
 * or email, filtered to All / Reported / Closed.
 *
 * **Sized for the Desk, not the feed.** D8's own header reads 412
 * ACCOUNTS; the counts are correlated subqueries on indexed columns
 * (`runs_user_started`, `reports_subject`), and the list is capped at
 * `RUNNERS_PAGE` rows, newest first. Search is a prefix on the handle,
 * which `user_profiles_username_nocase` serves, or on the email.
 *
 * **Reports here count only reports on the name or profile** (#22), so the
 * number says whether the account itself is the problem, not whether one
 * of their photos was.
 */
import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { user } from "../../db/schema-auth";
import { reports, runs, userProfiles } from "../../db/schema-core";

type Db = ReturnType<typeof drizzle>;

export type RunnerState = "ACTIVE" | "CLOSED";

export interface DeskRunner {
  userId: string;
  username: string | undefined;
  email: string;
  /**
  Epoch seconds.
  */
  joinedAt: number;
  runs: number;
  reports: number;
  state: RunnerState;
  banReason: string | undefined;
}

export interface RunnersFilter {
  query?: string | undefined;
  filter: "all" | "reported" | "closed";
}

/**
The most rows D8 draws at once.
*/
export const RUNNERS_PAGE = 100;

const profileReports = sql<number>`(SELECT COUNT(*) FROM ${reports} WHERE ${reports.subjectType} = 'profile' AND ${reports.subjectId} = ${user.id})`;

const runCount = sql<number>`(SELECT COUNT(*) FROM ${runs} WHERE ${runs.userId} = ${user.id})`;

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
  if (query === undefined || query === "") return;
  const pattern = prefixPattern(query.replace(/^@/u, ""));
  return or(
    sql`${userProfiles.username} LIKE ${pattern} ESCAPE '\\'`,
    sql`LOWER(${user.email}) LIKE ${pattern} ESCAPE '\\'`,
  );
}

const onlyWhere: Readonly<Record<RunnersFilter["filter"], SQL | undefined>> = {
  all: undefined,
  reported: sql`${profileReports} > 0`,
  closed: isNotNull(userProfiles.bannedAt),
};

export async function deskRunners(
  db: Db,
  { query, filter }: RunnersFilter,
): Promise<DeskRunner[]> {
  const rows = await db
    .select({
      userId: user.id,
      username: userProfiles.username,
      email: user.email,
      joinedAt: user.createdAt,
      runs: runCount,
      reports: profileReports,
      bannedAt: userProfiles.bannedAt,
      banReason: userProfiles.banReason,
    })
    .from(user)
    .leftJoin(userProfiles, eq(userProfiles.userId, user.id))
    .where(and(matching(query), onlyWhere[filter]))
    .orderBy(desc(user.createdAt))
    .limit(RUNNERS_PAGE);
  return rows.map((row) => ({
    userId: row.userId,
    username: row.username ?? undefined,
    email: row.email,
    joinedAt: Math.floor(row.joinedAt.getTime() / 1000),
    runs: row.runs,
    reports: row.reports,
    state: typeof row.bannedAt === "number" ? "CLOSED" : "ACTIVE",
    banReason: row.banReason ?? undefined,
  }));
}

/**
D8's header count: every account, whatever the filter.
*/
export async function accountCount(db: Db): Promise<number> {
  const [row] = await db.select({ count: sql<number>`COUNT(*)` }).from(user);
  return row?.count ?? 0;
}

