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

import { accountDeletions, reports, userProfiles } from "../../db/schema-core";
import { readInChunks } from "../../lib/chunked";
import { runCountsOf } from "../runs";

import { flaggedAtOf, flaggedWhere } from "./account-flags";

type Db = ReturnType<typeof drizzle<Record<string, never>>>;

/**
 * Round 27's D8 STATE. `PENDING DELETE`: the runner asked to delete the
 * account and its purge has not run (PR#126-1). Closed wins over it: a
 * closed account is hidden whether or not it is leaving.
 */
export type RunnerState = "ACTIVE" | "PENDING DELETE" | "CLOSED";

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
  /**
   * When an intimate-image removal of theirs last flagged the account
   * for a decision (D-161 1); absent when no flag is open.
   */
  flaggedAt: number | undefined;
}

export interface RunnersFilter {
  query?: string | undefined;
  filter: "all" | "reported" | "flagged" | "closed";
}

const onProfile = eq(reports.subjectType, "profile");

/**
 * D8's filter as a condition on the account's id, for `listAccounts`'
 * `only`: Reported has a report on the profile, Flagged an open flag
 * (`account-flags.ts`), Closed is banned. All is no condition at all.
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
  flagged: flaggedWhere,
  closed: (userId) =>
    sql`EXISTS (SELECT 1 FROM ${userProfiles} WHERE ${userProfiles.userId} = ${userId} AND ${isNotNull(userProfiles.bannedAt)})`,
};

/**
How many accounts each of D8's filters holds, for the filter links.
*/
export type RunnerCounts = Readonly<Record<RunnersFilter["filter"], number>>;

/**
 * Round 28 #8: every filter link carries its whole-table count, whatever
 * is searched. `countOf` is account's `accountCount`, handed in by the
 * route's server function (an import from here would be a cycle), and each
 * count reads the filter's own condition, so a count and its list cannot
 * disagree.
 */
export async function runnerCounts(
  countOf: (only: ((userId: SQLWrapper) => SQL) | undefined) => Promise<number>,
): Promise<RunnerCounts> {
  const [all, reported, closed, flagged] = await Promise.all([
    countOf(filterSql.all),
    countOf(filterSql.reported),
    countOf(filterSql.closed),
    countOf(filterSql.flagged),
  ]);
  return { all, reported, closed, flagged };
}

/**
 * Each listed account with its runs, its profile reports, its state and
 * any open flag, in the order the accounts came: five reads over at most a
 * page of ids, each in chunks under D1's 100-parameter cap. No accounts,
 * no reads.
 */
export async function deskRunners(
  db: Db,
  accounts: readonly ListedAccount[],
): Promise<DeskRunner[]> {
  const ids = accounts.map((account) => account.userId);
  const [runCounts, reportCounts, profiles, leaving, flags] = await Promise.all(
    [
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
      readInChunks(ids, async (chunk) =>
        db
          .select({ userId: accountDeletions.userId })
          .from(accountDeletions)
          .where(inArray(accountDeletions.userId, chunk)),
      ),
      readInChunks(ids, async (chunk) => [...(await flaggedAtOf(db, chunk))]),
    ],
  );
  const runsOf = new Map(runCounts.map((row) => [row.userId, row.runs]));
  const reportsOf = new Map(
    reportCounts.map((row) => [row.userId, row.reports]),
  );
  const profileOf = new Map(profiles.map((row) => [row.userId, row]));
  const leavingIds = new Set(leaving.map((row) => row.userId));
  const flaggedAt = new Map(flags);
  return accounts.map((account) => {
    const profile = profileOf.get(account.userId);
    return {
      ...account,
      runs: runsOf.get(account.userId) ?? 0,
      reports: reportsOf.get(account.userId) ?? 0,
      state: stateOf(
        typeof profile?.bannedAt === "number",
        leavingIds.has(account.userId),
      ),
      banReason: profile?.banReason ?? undefined,
      flaggedAt: flaggedAt.get(account.userId),
    };
  });
}

/**
Closed, then leaving, then active (`RunnerState`).
*/
function stateOf(isClosed: boolean, isLeaving: boolean): RunnerState {
  if (isClosed) return "CLOSED";
  return isLeaving ? "PENDING DELETE" : "ACTIVE";
}
