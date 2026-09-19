/**
 * Blocking (W2), which is the runner's own tool and not ours.
 *
 * Three properties the artboard states as copy, implemented here as
 * behaviour, because copy that the code contradicts is worse than no copy:
 *
 * - **Both directions.** "They can't see your entries, your closet, or find
 *   you in search" *and* "You won't see them in the feed or in search". One
 *   row, read from both ends — which is why `blocks_blocked` exists as well
 *   as the primary key.
 * - **Quiet.** Nothing notifies the blocked runner, and nothing renders a
 *   list anyone else can see. There is no notification insert here at all;
 *   that absence is the feature.
 * - **Still counts anonymously.** A blocked runner's verdicts stay in the
 *   conditions aggregate, because those name nobody. Nothing in this file
 *   is imported by the consensus path, and `blocks.test.ts` pins that from
 *   the outside so the carve-out cannot rot.
 */
import { and, eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { blocks, userProfiles } from "../../db/schema-core";
import { env } from "../../env";
import { columnSetAmong } from "../../lib/keyed-read";
import { nowSeconds } from "../../lib/now";

function db() {
  return drizzle(env.DIALED_CORE);
}

export class SelfBlockError extends Error {
  constructor() {
    super("a runner cannot block themselves");
  }
}

/**
 * Blocks `blockedId` for `blockerId`. Idempotent: blocking someone already
 * blocked is a no-op, not an error, because the UI offers no way to tell
 * and a retried submit must not fail (law 8b).
 */
export async function blockRunner(
  blockerId: string,
  blockedId: string,
): Promise<void> {
  if (blockerId === blockedId) throw new SelfBlockError();
  await db()
    .insert(blocks)
    .values({
      blockerId,
      blockedId,
      createdAt: nowSeconds(),
    })
    .onConflictDoNothing();
}

/**
 * Unblocks, taking effect immediately. W2: "Unblocking takes effect
 * immediately and doesn't re-follow anyone" — so this touches `blocks` and
 * nothing else. Restoring a follow would be inventing an intent.
 */
export async function unblockRunner(
  blockerId: string,
  blockedId: string,
): Promise<void> {
  await db()
    .delete(blocks)
    .where(
      and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)),
    );
}

/**
 * The singleton case of `blockedAmong`, expressed as one.
 *
 * Written out as its own `hasRowWhere` first, which gave the module two
 * spellings of "is this pair blocked" and left the clone detector right to
 * say so. One query shape now serves both, and `blocks_pk` leads on
 * `blocker_id` so a one-element `inArray` is the same index seek the
 * two-`eq` predicate was.
 */
export async function isBlocked(
  blockerId: string,
  blockedId: string,
): Promise<boolean> {
  const blocked = await blockedAmong(blockerId, [blockedId]);
  return blocked.has(blockedId);
}

/**
 * Every user id this viewer must not see and must not be seen by — their
 * own blocks and the blocks against them, in one read.
 *
 * **One query with an OR, not two.** The caller needs the union, and
 * issuing two reads to union them in memory bills D1 twice for an answer
 * one index pass gives. Both sides are index-served: `blocks_pk` leads on
 * `blocker_id`, `blocks_blocked` on `blocked_id`.
 */
export async function hiddenCounterpartIds(
  viewerId: string,
): Promise<string[]> {
  const rows = await db()
    .select({
      blockerId: blocks.blockerId,
      blockedId: blocks.blockedId,
    })
    .from(blocks)
    .where(or(eq(blocks.blockerId, viewerId), eq(blocks.blockedId, viewerId)));
  // Whichever end is not the viewer is the counterpart. A self-block cannot
  // exist (blockRunner refuses it), so this never returns the viewer.
  return rows.map((row) =>
    row.blockerId === viewerId ? row.blockedId : row.blockerId,
  );
}

export interface BlockedRunner {
  userId: string;
  displayName: string | undefined;
  blockedAt: number;
}

/**
 * The W2 roster. Empty is the normal case — the artboard says so, and the
 * screen is built around the explanation rather than the list — so this
 * returning nothing is not an edge case to guard.
 */
export async function blockedRunners(
  blockerId: string,
): Promise<BlockedRunner[]> {
  // One joined read, not a read plus an `IN` over its results. The pair
  // needed an `if (rows.length === 0)` in front of it, and that guard was
  // a branch no test could see: drizzle turns an empty `inArray` into a
  // predicate that matches nothing, so removing it changed no answer —
  // only the number of round trips. A LEFT JOIN has neither problem, and
  // it is left rather than inner because a blocked account may have no
  // profile row and must still appear on the roster.
  const rows = await db()
    .select({
      blockedId: blocks.blockedId,
      createdAt: blocks.createdAt,
      displayName: userProfiles.displayName,
    })
    .from(blocks)
    .leftJoin(userProfiles, eq(userProfiles.userId, blocks.blockedId))
    .where(eq(blocks.blockerId, blockerId));

  return rows.map((row) => ({
    userId: row.blockedId,
    displayName: row.displayName ?? undefined,
    blockedAt: row.createdAt,
  }));
}

/**
 * Which of these users this viewer has blocked — the read a "who reported
 * whom" list needs, kept here so `blocks` has one reader.
 */
export async function blockedAmong(
  blockerId: string,
  candidateIds: readonly string[],
): Promise<Set<string>> {
  // The membership clause is `columnSetAmong`'s to build, which is what
  // stops this returning every runner the blocker has ever blocked rather
  // than the ones on the page being filtered.
  return columnSetAmong(
    db(),
    blocks,
    blocks.blockedId,
    blocks.blockedId,
    candidateIds,
    eq(blocks.blockerId, blockerId),
  );
}
