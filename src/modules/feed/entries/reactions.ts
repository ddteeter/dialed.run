/**
 * "Useful" reactions (D-11). COUNT(*) on read, no denormalized counter —
 * the packet is explicit that the count query is cheap and correct at
 * MVP scale.
 */
import { and, count, eq, sql, type SQL } from "drizzle-orm";

import {
  outfitEntries,
  reactions,
  userProfiles,
} from "../../../db/schema-core";
import { coreDb } from "../../../env";
import { hasRowWhere } from "../../../lib/sql/keyed-read";
import { countOf, countWhere } from "../conditions";
import { entryVisibleTo, runnerInStanding } from "../../safety/rules";
import { nowSeconds } from "../../../lib/now";

function db() {
  return coreDb();
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
 * The answer to a press: the state the server now holds. A runner whose
 * address is not confirmed never gets here — `setUsefulAction` calls
 * `verifiedUserId` (round 26 #11; design 133, D-113), whose refusal opens
 * "Confirm your email first", never the failure band.
 */
export type UsefulOutcome = { readonly status: "set" } & UsefulState;

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
 * another runner"), asked by the server function's gate before anything
 * here runs (`verifiedUserId`, D-113): an unconfirmed runner is told the
 * same thing whatever they pressed, so the refusal says nothing about an
 * entry they may not see. Taking a mark back waits too — an unconfirmed
 * runner has none to take back.
 */
export async function setUsefulReaction(
  entryId: string,
  userId: string,
  isUseful: boolean,
): Promise<UsefulOutcome> {
  const database = db();
  // Taking a mark back always works (SA-L02, owner 2026-11-15): it tells
  // the runner nothing the mark they made did not, and a block made after
  // marking must not leave their mark stuck on the author's kit.
  if (isUseful) await assertVisible(entryId, userId);
  const mine = and(
    eq(reactions.entryId, entryId),
    eq(reactions.userId, userId),
  );
  // The count comes back only for an entry the runner may see: a
  // take-back on any other entry answers zero.
  const counted = and(
    countedUsefulOf(eq(reactions.entryId, entryId)),
    entrySeenBy(entryId, userId),
  );
  // The mark asks the rule again as it lands, so a block, a ban or a
  // change of audience since the check above leaves no mark. The columns
  // in the table's order: entry, runner, kind, time.
  const write = isUseful
    ? database
        .insert(reactions)
        .select(
          sql`SELECT ${entryId}, ${userId}, 'useful', ${nowSeconds()} WHERE ${entrySeenBy(entryId, userId)}`,
        )
        .onConflictDoNothing()
    : database.delete(reactions).where(mine);
  const [, all, own] = await database.batch([
    write,
    database.select({ n: count() }).from(reactions).where(counted),
    database.select({ n: count() }).from(reactions).where(mine),
  ]);
  return { status: "set", useful: countOf(own) > 0, count: countOf(all) };
}

/**
 * The entry exists and `viewerId` may see it, by the one rule
 * (`entryVisibleTo`), as a clause of a read on another table.
 */
function entrySeenBy(entryId: string, viewerId: string): SQL {
  return sql`exists (select 1 from ${outfitEntries} where ${and(eq(outfitEntries.id, entryId), entryVisibleTo(viewerId))})`;
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
  return countWhere(
    db(),
    reactions,
    countedUsefulOf(eq(reactions.entryId, entryId)),
  );
}

/**
 * SA-L02: the marks a Useful count counts — `which`, made by a runner in
 * standing (`runnerInStanding`: not banned, not leaving, not a system
 * account, confirmed). A ban moves the count, as the contract says of
 * every number everyone reads; a block does not, because a count that
 * differed per viewer would say who blocked whom. Every read of the count
 * goes through this, so they cannot disagree.
 */
export function countedUsefulOf(which: SQL | undefined): SQL | undefined {
  return and(
    which,
    sql`exists (select 1 from ${userProfiles} where ${userProfiles.userId} = ${reactions.userId} and ${runnerInStanding()})`,
  );
}
