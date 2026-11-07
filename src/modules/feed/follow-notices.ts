/**
 * Follow notifications (D-168; round 48 #131). A follow rings the bell
 * with "@ada followed you."; more follows while that row is unread join it
 * as "@ada and 3 others followed you.", naming the newest. Nothing is sent
 * for a runner either side has blocked, and a follower rings a runner at
 * most once in 30 days, so an unfollow and refollow does not ring twice.
 * No email, and no setting (R48·131d).
 */
import { and, count, eq, sql } from "drizzle-orm";

import {
  blocks,
  followNotices,
  notifications,
  userProfiles,
} from "../../db/schema-core";
import { primaryCoreDb } from "../../env";
import { newUlid } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";
import { notificationInsert } from "../notifications";
import { captureException } from "../ops";

/**
 * How long after a ring a follower stays quiet on the same runner's bell.
 */
export const RING_QUIET_SECONDS = 30 * 24 * 60 * 60;

/**
 * The bell row's words: the newest follower, and how many joined before.
 */
export function followBody(handle: string, others: number): string {
  if (others === 0) return `@${handle} followed you.`;
  const noun = others === 1 ? "other" : "others";
  return `@${handle} and ${String(others)} ${noun} followed you.`;
}

type Db = ReturnType<typeof primaryCoreDb>;

/**
 * What decides the ring, read in one round trip from the primary: a
 * replica a second behind would ring twice for one double-tap. The
 * follower's row carries the rest as subqueries — whether either runner
 * blocked the other, and when this follower last rang — so a follower
 * with no profile answers nothing at all.
 */
async function ringState(db: Db, followerId: string, followeeId: string) {
  const unreadFollow = and(
    eq(notifications.userId, followeeId),
    eq(notifications.kind, "followed"),
    eq(notifications.read, false),
  );
  const [follower, unread] = await db.batch([
    db
      .select({
        handle: userProfiles.username,
        isBlocked:
          sql<number>`exists (select 1 from ${blocks} where (${blocks.blockerId} = ${followeeId} and ${blocks.blockedId} = ${followerId}) or (${blocks.blockerId} = ${followerId} and ${blocks.blockedId} = ${followeeId}))`.mapWith(
            Boolean,
          ),
        rungAt: sql<
          number | null
        >`(select ${followNotices.rungAt} from ${followNotices} where ${followNotices.followeeId} = ${followeeId} and ${followNotices.followerId} = ${followerId})`,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, followerId)),
    db
      .select({ id: notifications.id, groupId: notifications.subjectId })
      .from(notifications)
      .where(unreadFollow),
  ]);
  return { follower: follower[0], unread: unread[0] };
}

function ringUpsert(
  db: Db,
  ring: { followerId: string; followeeId: string; groupId: string; at: number },
) {
  const set = { notificationId: ring.groupId, rungAt: ring.at };
  return db
    .insert(followNotices)
    .values({
      followeeId: ring.followeeId,
      followerId: ring.followerId,
      ...set,
    })
    .onConflictDoUpdate({
      target: [followNotices.followeeId, followNotices.followerId],
      set,
    });
}

/**
 * Rings the followee's bell for a follow that just landed, or does
 * nothing it should not. The ring and the row it joins go in one batch.
 */
export async function ringFollow(
  followerId: string,
  followeeId: string,
): Promise<void> {
  const db = primaryCoreDb();
  const now = nowSeconds();
  const { follower, unread } = await ringState(db, followerId, followeeId);
  const handle = follower?.handle;
  if (follower === undefined || follower.isBlocked || handle == undefined) {
    return;
  }
  const { rungAt } = follower;
  if (rungAt !== null && rungAt > now - RING_QUIET_SECONDS) return;
  const ring = { followerId, followeeId, at: now };
  if (unread?.groupId == undefined) {
    const groupId = newUlid();
    await db.batch([
      ringUpsert(db, { ...ring, groupId }),
      notificationInsert(db, {
        userId: followeeId,
        kind: "followed",
        subjectId: groupId,
        linkId: followerId,
        body: followBody(handle, 0),
        createdAt: now,
      }),
    ]);
    return;
  }
  const [joined] = await db
    .select({ n: count() })
    .from(followNotices)
    .where(eq(followNotices.notificationId, unread.groupId));
  const body = followBody(handle, joined?.n ?? 0);
  const stillUnread = and(
    eq(notifications.id, unread.id),
    eq(notifications.read, false),
  );
  await db.batch([
    ringUpsert(db, { ...ring, groupId: unread.groupId }),
    // A group has no one follower to open (R48·131c), so no link id. Still
    // unread, or the runner read it in between and the ring joins nothing.
    db
      .update(notifications)
      .set({ body, linkId: sql`NULL`, createdAt: now })
      .where(stillUnread),
  ]);
}

/**
 * The follow's secondary half (law 5): a ring that fails never fails the
 * follow. The failure goes to Sentry with both runners, and the bell says
 * nothing, which is what a missing ring already says.
 */
export async function ringFollowQuietly(
  followerId: string,
  followeeId: string,
  ring: typeof ringFollow = ringFollow,
  report: typeof captureException = captureException,
): Promise<void> {
  try {
    await ring(followerId, followeeId);
  } catch (error) {
    report(error, { area: "follow-notice", followerId, followeeId });
  }
}
