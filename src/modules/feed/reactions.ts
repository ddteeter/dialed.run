/**
 * "Useful" reactions (D-11). COUNT(*) on read, no denormalized counter —
 * the packet is explicit that the count query is cheap and correct at
 * MVP scale.
 */
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { outfitEntries, reactions } from "../../db/schema-core";
import { env } from "../../env";
import { hasRowWhere } from "../../lib/sql/keyed-read";
import { countOf, countWhere } from "./count-where";
import { isVerified } from "../account";
import { entryVisibleTo } from "../safety";
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
  // Reacting to a hidden entry would leak that it exists, and would put a
  // count on something a reviewer may be about to remove. The one rule
  // decides, in the WHERE (task 128): a blocked pair cannot mark each
  // other's entries, nor can a runner mark a banned author's.
  const [entry] = await db()
    .select({ id: outfitEntries.id })
    .from(outfitEntries)
    .where(and(eq(outfitEntries.id, entryId), entryVisibleTo(viewerId)))
    .limit(1);
  if (!entry) throw new NotVisibleError();
}

/**
 * What an entry's Useful now is, as the server has it after a write.
 */
export interface UsefulState {
  useful: boolean;
  count: number;
}

/**
 * The answer to a press: the state the server now holds, or the refusal
 * of a runner whose address is not confirmed yet (round 26 #11; seam 7).
 * A refusal is an answer, not a failure — the screen opens "Confirm your
 * email first", never the failure band.
 */
export type UsefulOutcome =
  | ({ readonly status: "set" } & UsefulState)
  | { readonly status: "unverified" };

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
 *
 * **Waits for a confirmed address** (round 26 #11: Useful "shows to
 * another runner"), asked before the entry is: an unconfirmed runner is
 * told the same thing whatever they pressed, so the refusal says nothing
 * about an entry they may not see. Taking a mark back waits too — an
 * unconfirmed runner has none to take back.
 */
export async function setUsefulReaction(
  entryId: string,
  userId: string,
  isUseful: boolean,
): Promise<UsefulOutcome> {
  const database = db();
  if (!(await isVerified(database, userId))) return { status: "unverified" };
  await assertVisible(entryId, userId);
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
  return { status: "set", useful: countOf(own) > 0, count: countOf(all) };
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
  return countWhere(db(), reactions, eq(reactions.entryId, entryId));
}
