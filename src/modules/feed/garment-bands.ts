/**
 * How many temperature bands a garment has a record in (task 128 · SAF-16):
 * the number round 26's delete sheet names — "Its record in {b} bands" —
 * so a runner deleting a piece is told what the delete costs them.
 *
 * **A record is what A3's band history counts**: a verdicted run the piece
 * was worn on, placed in the 5 °C band its judged feel sits in. One piece
 * worn on five dialed runs at 41° has a record in one band.
 *
 * **In feed, not closet**, because the band comes from the run's weather,
 * and the walk from an entry to its observation (`observationsForEntries`,
 * `judgedFeelsLikeC`) is feed's. The arrow runs feed → closet, so the
 * closet route composes this count rather than closet importing it.
 *
 * **Asked for when the sheet opens, never with the page** (PR #129
 * review). The count walks every verdicted run in the piece and then the
 * weather, and it is a line in a sheet most views never open — so it is
 * not the garment page's to pay for, and not the page's to fail with.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";

import { outfitEntries, outfitEntryItems } from "../../db/schema-core";
import { ulidSchema } from "../../lib/ids";
import { bandFloorC } from "../../lib/temperature";
import { captureException } from "../ops";
import { observationsForEntries } from "./conditions";
import { judgedFeelsLikeC } from "./judged-conditions";

type Db = DrizzleD1Database;

/**
The garment whose record is asked for.
*/
export const garmentBandsInput = z.object({ itemId: ulidSchema });

/**
 * The number of distinct bands this runner's verdicted runs in this piece
 * fall in. Scoped to the runner in SQL: another runner's garment id is a
 * record of nothing.
 */
export async function garmentBandCount(
  db: Db,
  userId: string,
  itemId: string,
): Promise<number> {
  // Driven from `entries_user_created`, with the kit row found by the
  // (entry_id, item_id) pair index: an item-only filter would scan every
  // runner's kit rows.
  const worn = await db
    .select({ runId: outfitEntries.runId, verdict: outfitEntries.verdict })
    .from(outfitEntries)
    .innerJoin(
      outfitEntryItems,
      and(
        eq(outfitEntryItems.entryId, outfitEntries.id),
        eq(outfitEntryItems.itemId, itemId),
      ),
    )
    .where(
      and(eq(outfitEntries.userId, userId), isNotNull(outfitEntries.verdict)),
    );
  // The band cannot be read in SQL: it comes from an observation in
  // DIALED_WEATHER, and DIALED_CORE cannot join across databases
  // (CLAUDE.md §D1 query discipline). A run with no observation has no
  // band, and counts in none.
  const observations = await observationsForEntries(db, worn);
  const bands = new Set<number>();
  for (const entry of worn) {
    const observation = observations.get(entry.runId);
    if (observation !== undefined) {
      bands.add(bandFloorC(judgedFeelsLikeC(observation, entry.verdict)));
    }
  }
  return bands.size;
}

/**
 * The count, or `undefined` when it could not be had (law 5): the band row is
 * one line of what a delete costs, and a weather lookup that fails must
 * not take the sheet — let alone the delete — down with it. The failure
 * goes to Sentry with the garment and runner, and the sheet leaves the
 * row out.
 */
export async function garmentBandCountOrNone(
  db: Db,
  userId: string,
  itemId: string,
  count: typeof garmentBandCount = garmentBandCount,
  report: typeof captureException = captureException,
): Promise<number | undefined> {
  try {
    return await count(db, userId, itemId);
  } catch (error) {
    report(error, { surface: "garment-band-count", userId, itemId });
    return undefined;
  }
}
