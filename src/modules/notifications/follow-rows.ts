/**
 * The follow rows on other runners' bells that name one runner, for the
 * writes that take a runner's handle out of everyone's sight: the purge,
 * a moderator's rename, a ban.
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import { followNotices, notifications } from "../../db/schema-core";

type Db = ReturnType<typeof drizzle>;

/**
 * SA-L09: the follow rows on other runners' bells that name this runner —
 * one they alone rang (it links to them), or a group whose words name them
 * as its newest follower ("@ada and 3 others followed you."). A group that
 * names someone else stays: it counts them, and names nobody gone. Found
 * through their rings (`follow_notices_follower`), each bell's row by its
 * runner, kind and group (`notifications_dedupe`).
 */
export function followRowsNaming(
  db: Db,
  userId: string,
  handle: string | undefined,
) {
  const theirRings = (column: SQLiteColumn) =>
    db
      .select({ id: column })
      .from(followNotices)
      .where(eq(followNotices.followerId, userId));
  const opening = "@" + String(handle) + " ";
  const named =
    handle === undefined
      ? eq(notifications.linkId, userId)
      : or(
          eq(notifications.linkId, userId),
          sql`substr(${notifications.body}, 1, ${opening.length}) = ${opening}`,
        );
  return and(
    inArray(notifications.userId, theirRings(followNotices.followeeId)),
    eq(notifications.kind, "followed"),
    inArray(notifications.subjectId, theirRings(followNotices.notificationId)),
    named,
  );
}
