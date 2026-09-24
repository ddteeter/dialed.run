/**
 * "Useful" reactions (D-11). COUNT(*) on read, no denormalized counter —
 * the packet is explicit that the count query is cheap and correct at
 * MVP scale.
 */
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { outfitEntries, reactions } from "../../db/schema-core";
import { env } from "../../env";
import { columnWhere, hasRowWhere } from "../../lib/keyed-read";
import { isEntryPubliclyVisible } from "../safety";
import { nowSeconds } from "../../lib/now";

function db() {
  return drizzle(env.DIALED_CORE);
}

class NotVisibleError extends Error {
  constructor() {
    super("entry is not visible to this viewer");
  }
}

async function assertVisible(entryId: string, viewerId: string): Promise<void> {
  const [entry] = await db()
    .select({
      userId: outfitEntries.userId,
      isPublic: outfitEntries.isPublic,
      moderationStatus: outfitEntries.moderationStatus,
    })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId))
    .limit(1);
  if (!entry) throw new NotVisibleError();
  // Reacting to a hidden entry would leak that it exists, and would put a
  // count on something a reviewer may be about to remove.
  if (!isEntryPubliclyVisible(entry) && entry.userId !== viewerId) {
    throw new NotVisibleError();
  }
}

/**
 * What an entry's Useful now is, as the server has it after a write.
 */
export interface UsefulState {
  useful: boolean;
  count: number;
}

/**
 * Sets the viewer's "useful" reaction to the state they asked for, and
 * answers with the state the server now holds.
 *
 * **A set, never a toggle** (law 8b: user writes are at-least-once). A
 * toggle reads "flip whatever is there", so a press whose response was
 * lost, retried from the failure band, flips it back — and a stale card in
 * another tab flips it the wrong way. Asking for the state instead makes a
 * repeat harmless: marking twice is marked, unmarking twice is unmarked
 * (`INSERT … ON CONFLICT DO NOTHING` against the UNIQUE pair, a `DELETE`
 * of nothing).
 *
 * The write and the reads that report on it go in one batch, so the count
 * and the viewer's own mark are the ones that write left behind rather than
 * a read racing another reactor's. The caller shows these, never ±1.
 */
export async function setUsefulReaction(
  entryId: string,
  userId: string,
  isUseful: boolean,
): Promise<UsefulState> {
  await assertVisible(entryId, userId);
  const database = db();
  const mine = and(
    eq(reactions.entryId, entryId),
    eq(reactions.userId, userId),
  );
  const write = isUseful
    ? database
        .insert(reactions)
        .values({ entryId, userId, kind: "useful", createdAt: nowSeconds() })
        .onConflictDoNothing()
    : database.delete(reactions).where(mine);
  const [, all, own] = await database.batch([
    write,
    database
      .select({ n: count() })
      .from(reactions)
      .where(eq(reactions.entryId, entryId)),
    database.select({ n: count() }).from(reactions).where(mine),
  ]);
  return { useful: countOf(own) > 0, count: countOf(all) };
}

/**
 * What a `count()` answered. It always answers with one row; summing them
 * says so without a fallback for a row that cannot be missing.
 */
function countOf(rows: readonly { n: number }[]): number {
  return rows.reduce((total, row) => total + row.n, 0);
}

export async function hasReacted(
  entryId: string,
  userId: string,
): Promise<boolean> {
  return hasRowWhere(
    db(),
    reactions,
    reactions.userId,
    and(eq(reactions.entryId, entryId), eq(reactions.userId, userId)),
  );
}

export async function usefulCount(entryId: string): Promise<number> {
  const reactors = await columnWhere(
    db(),
    reactions,
    reactions.userId,
    eq(reactions.entryId, entryId),
  );
  return reactors.length;
}
