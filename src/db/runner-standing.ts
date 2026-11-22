/**
 * The floor under every surface that shows one runner to someone else, as
 * `WHERE` clauses over `user_profiles`: not banned, not a system account,
 * not leaving, address confirmed. Here, beside the tables and below the modules, because feed's
 * search, H and open web and safety's reports all ask it, and safety may
 * not import feed.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import { accountDeletions, userProfiles } from "./schema-core";
import { runnerConfirmed } from "./runner-confirmed";

/**
 * A runner who asked to delete their account is gone from everyone else
 * at once (task 126, ACC-9; round 27 #14: "Shared runs leave the feed at
 * once and stop counting toward anyone's Call"), for the week before the
 * purge. The claim row is the hide, as a ban's column is: nothing about
 * the entries is written, so "Keep my account" brings them back as they
 * were. A primary-key probe per candidate.
 *
 * `runnerId` is the column naming the runner — an entry's author, or a
 * profile row's user in the feed's search and H (seam 6: one rule).
 */
export function runnerNotLeaving(runnerId: SQLiteColumn): SQL {
  return sql`not exists (select 1 from ${accountDeletions} where ${accountDeletions.userId} = ${runnerId})`;
}

/**
 * With no viewer in it, this is the open web's profile's (`/@handle`,
 * D-151) whole runner rule; feed's signed-in rule adds the viewer's own
 * blocks and reports.
 */
export function runnerInStanding() {
  return and(
    isNull(userProfiles.bannedAt),
    // Design 193 (#533): an account the service runs, the smoke account,
    // is no runner. Not found in search, at H or on the open web.
    eq(userProfiles.systemAccount, false),
    // Task 126 (ACC-9): a runner deleting their account leaves search, H
    // and the open web at once (seam 6).
    runnerNotLeaving(userProfiles.userId),
    // Design 133 (D-113 Q2): an unconfirmed runner is not findable — in
    // search, at H, through H's redirect from an id, or on the open web.
    runnerConfirmed(userProfiles.userId),
  );
}
