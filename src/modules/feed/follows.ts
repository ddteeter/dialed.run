/**
 * Follow graph. `follows(follower_id, followee_id)` is the only table;
 * follower counts/following counts are COUNT(*) queries against its
 * covering index (docs/contracts.md) — no denormalized counters.
 */
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { follows } from "../../db/schema-core";
import { env } from "../../env";

function db() {
  return drizzle(env.DIALED_CORE);
}

export async function follow(
  followerId: string,
  followeeId: string,
): Promise<void> {
  if (followerId === followeeId) return; // no self-follow, silently ignored
  await db()
    .insert(follows)
    .values({
      followerId,
      followeeId,
      createdAt: Math.floor(Date.now() / 1000),
    })
    .onConflictDoNothing();
}

export async function unfollow(
  followerId: string,
  followeeId: string,
): Promise<void> {
  await db()
    .delete(follows)
    .where(
      and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)),
    );
}

export async function isFollowing(
  followerId: string,
  followeeId: string,
): Promise<boolean> {
  const rows = await db()
    .select({ followeeId: follows.followeeId })
    .from(follows)
    .where(
      and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)),
    )
    .limit(1);
  return rows.length > 0;
}

/**
Covering index `follows(follower_id, followee_id)` — index seek, not a scan.
*/
export async function followeeIdsOf(followerId: string): Promise<string[]> {
  const rows = await db()
    .select({ followeeId: follows.followeeId })
    .from(follows)
    .where(eq(follows.followerId, followerId));
  return rows.map((r) => r.followeeId);
}

export async function followerCount(userId: string): Promise<number> {
  const rows = await db()
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(eq(follows.followeeId, userId));
  return rows.length;
}

export async function followingCount(userId: string): Promise<number> {
  const ids = await followeeIdsOf(userId);
  return ids.length;
}
