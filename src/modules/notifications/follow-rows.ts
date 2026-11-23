/**
 * The follow rows on other runners' bells that name one runner, for the
 * writes that take a runner's handle out of everyone's sight: the purge,
 * a moderator's rename, a ban.
 */
import {
  and,
  eq,
  inArray,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import {
  followNotices,
  notifications,
  usernameHistory,
} from "../../db/schema-core";
import { qualified } from "../../lib/sql/qualified";

type Db = ReturnType<typeof drizzle>;

/**
 * SA-L09: the follow rows on other runners' bells that name this runner —
 * one they alone rang (it links to them), or a group whose words name them
 * as its newest follower ("@ada and 3 others followed you."), by the
 * handle they hold now or any handle they held before (their
 * `username_history`, by `username_history_user`). A group that names
 * someone else stays: it counts them, and names nobody gone. Found
 * through their rings (`follow_notices_follower`), each bell's row by its
 * runner, kind and group (`notifications_dedupe`).
 */
export function followRowsNaming(
  db: Db,
  userId: string,
  handle: string | undefined,
) {
  const history = usernameHistory;
  const theirs = sql`${qualified(history, history.userId)} = ${userId}`;
  const opensWithIt = opens(qualified(history, history.username));
  const heldBefore = sql`exists (select 1 from ${history} where ${theirs} and ${opensWithIt})`;
  const named = or(
    eq(notifications.linkId, userId),
    heldBefore,
    // `or` leaves out an undefined condition: a runner with no handle now
    // is named only by their link and the handles they held before.
    handle === undefined ? undefined : opens(sql.param(handle)),
  );
  return and(ringsOf(db, userId), named);
}

/**
 * The follow rows this runner rang on other bells whose words open with
 * `handle`, a handle they held: what a moderator's lock of that handle
 * takes off the bells, and nothing that names another of theirs.
 */
export function followRowsOpeningWith(db: Db, userId: string, handle: string) {
  return and(ringsOf(db, userId), opens(sql.param(handle)));
}

/**
The bells' follow rows that hold one of this runner's rings.
*/
function ringsOf(db: Db, userId: string) {
  const theirRings = (column: SQLiteColumn) =>
    db
      .select({ id: column })
      .from(followNotices)
      .where(eq(followNotices.followerId, userId));
  return and(
    inArray(notifications.userId, theirRings(followNotices.followeeId)),
    eq(notifications.kind, "followed"),
    inArray(notifications.subjectId, theirRings(followNotices.notificationId)),
  );
}

/**
Whether a row's words open with the handle, as "@<handle> …".
*/
function opens(handle: SQLWrapper): SQL {
  return sql`substr(${notifications.body}, 1, length(${handle}) + 2) = '@' || ${handle} || ' '`;
}
