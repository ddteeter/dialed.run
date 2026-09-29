/**
 * Desk · Runners, "D8" (round 27 #22): every account, searchable by handle
 * or email, filtered to All / Reported / Closed.
 *
 * **Safety reads only what is safety's.** The accounts come from
 * `modules/account` (`listAccounts`) and the run counts from `modules/runs`
 * (`runCountsOf`); what this adds is the filter, as SQL on the account's
 * id so it narrows before account's `LIMIT`, and each row's reports and
 * state. The route's server function wires the three together, because
 * account reaches `ops`, which reaches safety — an import from here would
 * be a cycle.
 *
 * **Reports here count only reports on the name or profile** (#22), so the
 * number says whether the account itself is the problem, not whether one
 * of their photos was.
 */
import { and, count, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { SQL, SQLWrapper } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { reports, userProfiles } from "../../db/schema-core";
import { readInChunks } from "../../lib/chunked";
import { runCountsOf } from "../runs";

type Db = ReturnType<typeof drizzle<Record<string, never>>>;

export type RunnerState = "ACTIVE" | "CLOSED";

/**
What account hands the Desk for each row (`AccountRow` in `modules/account`).
*/
export interface ListedAccount {
  userId: string;
  username: string | undefined;
  email: string;
  joinedAt: number;
}

export interface DeskRunner extends ListedAccount {
  runs: number;
  reports: number;
  state: RunnerState;
  banReason: string | undefined;
}

export interface RunnersFilter {
  query?: string | undefined;
  filter: "all" | "reported" | "closed";
}

const onProfile = eq(reports.subjectType, "profile");

/**
 * D8's filter as a condition on the account's id, for `listAccounts`'
 * `only`: Reported has a report on the profile, Closed is banned. All is
 * no condition at all.
 */
export function runnersWhere(
  filter: RunnersFilter["filter"],
): ((userId: SQLWrapper) => SQL) | undefined {
  return filterSql[filter];
}

const filterSql: Readonly<
  Record<RunnersFilter["filter"], ((userId: SQLWrapper) => SQL) | undefined>
> = {
  all: undefined,
  reported: (userId) =>
    sql`EXISTS (SELECT 1 FROM ${reports} WHERE ${onProfile} AND ${reports.subjectId} = ${userId})`,
  closed: (userId) =>
    sql`EXISTS (SELECT 1 FROM ${userProfiles} WHERE ${userProfiles.userId} = ${userId} AND ${isNotNull(userProfiles.bannedAt)})`,
};

/**
 * Each listed account with its runs, its profile reports and whether it is
 * closed, in the order the accounts came: three reads over at most a page
 * of ids, each in chunks under D1's 100-parameter cap. No accounts, no
 * reads.
 */
export async function deskRunners(
  db: Db,
  accounts: readonly ListedAccount[],
): Promise<DeskRunner[]> {
  const ids = accounts.map((account) => account.userId);
  const [runCounts, reportCounts, profiles] = await Promise.all([
    readInChunks(ids, async (chunk) => runCountsOf(db, chunk)),
    readInChunks(ids, async (chunk) =>
      db
        .select({ userId: reports.subjectId, reports: count() })
        .from(reports)
        .where(and(onProfile, inArray(reports.subjectId, chunk)))
        .groupBy(reports.subjectId),
    ),
    readInChunks(ids, async (chunk) =>
      db
        .select({
          userId: userProfiles.userId,
          bannedAt: userProfiles.bannedAt,
          banReason: userProfiles.banReason,
        })
        .from(userProfiles)
        .where(inArray(userProfiles.userId, chunk)),
    ),
  ]);
  const runsOf = new Map(runCounts.map((row) => [row.userId, row.runs]));
  const reportsOf = new Map(
    reportCounts.map((row) => [row.userId, row.reports]),
  );
  const profileOf = new Map(profiles.map((row) => [row.userId, row]));
  return accounts.map((account) => {
    const profile = profileOf.get(account.userId);
    return {
      ...account,
      runs: runsOf.get(account.userId) ?? 0,
      reports: reportsOf.get(account.userId) ?? 0,
      state: typeof profile?.bannedAt === "number" ? "CLOSED" : "ACTIVE",
      banReason: profile?.banReason ?? undefined,
    };
  });
}
