/**
 * Follow graph. `follows(follower_id, followee_id)` is the only table;
 * follower counts/following counts are COUNT(*) queries against its
 * covering index (docs/contracts.md) — no denormalized counters.
 */
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { follows } from "../../db/schema-core";
import { env } from "../../env";
import { columnWhere, hasRowWhere } from "../../lib/keyed-read";

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

// fallow-ignore-next-line code-duplication -- isFollowing and hasReacted both delegate to hasRowWhere; following someone and finding an entry useful are different facts over different tables
export async function isFollowing(
  followerId: string,
  followeeId: string,
): Promise<boolean> {
  return hasRowWhere(
    db(),
    follows,
    follows.followeeId,
    and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)),
  );
}

/**
Covering index `follows(follower_id, followee_id)` — index seek, not a scan.
*/
export async function followeeIdsOf(followerId: string): Promise<string[]> {
  return columnWhere(
    db(),
    follows,
    follows.followeeId,
    // fallow-ignore-next-line code-duplication -- followerCount and usefulCount both delegate to columnWhere, each over its own covering index
    eq(follows.followerId, followerId),
  );
}

export async function followerCount(userId: string): Promise<number> {
  const followers = await columnWhere(
    db(),
    follows,
    follows.followerId,
    eq(follows.followeeId, userId),
  );
  return followers.length;
}

export async function followingCount(userId: string): Promise<number> {
  const ids = await followeeIdsOf(userId);
  return ids.length;
}
