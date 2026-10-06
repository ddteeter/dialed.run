import { and, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";
import { runnerConfirmed } from "../account";
import {
  notBlockedEitherWay,
  profileNotReportedBy,
  runnerNotLeaving,
} from "../safety";

/**
 * Whether `viewerId` may see a runner at all: not banned, not in a block
 * pair with the viewer either way, not a profile the viewer has reported
 * (D-68), and with a confirmed address (D-113 Q2: a handle may be claimed
 * unconfirmed, but nobody finds it until the address is confirmed). Shared by runner search (W2, FEED-7) and H's
 * `visibleRunnerStatement` — both are a `WHERE` over `user_profiles` that
 * answers the same question, so a future exclusion (a new report reason, a
 * new kind of hide) belongs here once, not in two clauses that have to be
 * kept in step by hand.
 *
 * Callers still add their own predicate (a prefix match, `eq(userId, …)`)
 * alongside this one — it is only the visibility floor, not the whole
 * `WHERE`.
 */
export function runnerVisibleToViewer(viewerId: string) {
  return and(
    isNull(userProfiles.bannedAt),
    // Task 126 (ACC-9): a runner deleting their account leaves search and
    // H at once, by safety's rule (seam 6).
    runnerNotLeaving(userProfiles.userId),
    // Design 133 (D-113 Q2): an unconfirmed runner is not findable — in
    // search, at H, or through H's old `/feed/u/$userId` redirect.
    runnerConfirmed(userProfiles.userId),
    notBlockedEitherWay(viewerId, userProfiles.userId),
    profileNotReportedBy(viewerId, userProfiles.userId),
  );
}

/**
 * The `select … from user_profiles where …` skeleton runner search and H
 * both build: the three columns either reads a runner by, filtered to
 * `runnerVisibleToViewer` plus the caller's own predicate. Search adds a
 * prefix match and excludes the viewer; H adds `eq(userId, …)`. Extracting
 * this is what keeps that skeleton from being written out twice — a clone
 * `dupes` catches even after the `WHERE`-floor above was already shared,
 * because the surrounding `select`/`from` was still repeated verbatim.
 *
 * All three columns are selected either way, even though one caller reads
 * only `username`/`cityLabel` and the other only `userId`/`username`: a
 * result no caller asked for is discarded by their own mapping, and never
 * changes which index answers a `WHERE` that does not mention it.
 */
export function runnersVisibleTo(
  database: DrizzleD1Database,
  viewerId: string,
  where: SQL | undefined,
) {
  return database
    .select({
      userId: userProfiles.userId,
      username: userProfiles.username,
      cityLabel: userProfiles.cityLabel,
    })
    .from(userProfiles)
    .where(and(where, runnerVisibleToViewer(viewerId)));
}
