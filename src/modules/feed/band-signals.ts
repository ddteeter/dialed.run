import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  entryTags,
  outfitEntries,
  outfitEntryItems,
} from "../../db/schema-core";
import { env } from "../../env";
import { chunked } from "../../lib/chunked";
import { verdictedEntriesInBand } from "./entries";

/**
 * How one garment has done in this band: how many of the runner's
 * verdicted runs here it was worn on, and which way each went.
 */
export interface GarmentRecord {
  total: number;
  dialed: number;
  /**
   * Runs it was worn on that the runner called cold — either step. Folded
   * by sign, as the verdict hues are.
   */
  colder: number;
  warmer: number;
}

/**
 * What A3's generated chips are chosen from (design round 20): each kit
 * garment's record in the run's band, and how often this runner has used
 * each tag there.
 *
 * *"Up to two per-garment flags … garment picked by the weakest band
 * record — then tags ranked by this runner's use in the band."* Both halves
 * are the runner's own history, read over the same in-band entries the
 * history line counts, so the chips and the line beneath the row can never
 * disagree about what "this band" contains.
 */
export interface BandSignals {
  garments: Readonly<Record<string, GarmentRecord>>;
  tagUse: Readonly<Record<string, number>>;
}

/**
 * D1 caps bound parameters per statement, and an in-band entry list runs
 * to 200. Chunks stay well under the cap with room for the other operand.
 */
const CHUNK = 80;

function db() {
  return drizzle(env.DIALED_CORE);
}

/**
The kit garments worn on any of these entries.
*/
function garmentsWornIn(entryIds: string[], itemIds: readonly string[]) {
  return db()
    .select({
      entryId: outfitEntryItems.entryId,
      itemId: outfitEntryItems.itemId,
    })
    .from(outfitEntryItems)
    .where(
      and(
        inArray(outfitEntryItems.entryId, entryIds),
        inArray(outfitEntryItems.itemId, [...itemIds]),
      ),
    );
}

/**
Every tag on any of these entries, once per use.
*/
function tagsUsedIn(entryIds: string[]) {
  return db()
    .select({ tag: entryTags.tag })
    .from(entryTags)
    .where(inArray(entryTags.entryId, entryIds));
}

export async function bandSignals(
  userId: string,
  bandFloorC: number,
  itemIds: readonly string[],
  excludeEntryId?: string,
): Promise<BandSignals> {
  const inBand = await verdictedEntriesInBand(
    userId,
    bandFloorC,
    excludeEntryId,
  );
  const verdictOf = new Map(inBand.map((entry) => [entry.id, entry.verdict]));
  const garments = new Map<string, GarmentRecord>();
  // Every kit garment gets a record, worn in this band or not — a garment
  // with no record here is a fact the chip rules need, not a missing key.
  const recordFor = (itemId: string): GarmentRecord => {
    const record = { total: 0, dialed: 0, colder: 0, warmer: 0 };
    garments.set(itemId, record);
    return record;
  };
  for (const itemId of itemIds) recordFor(itemId);
  const tagUse: Record<string, number> = {};

  const chunks = chunked(
    inBand.map((entry) => entry.id),
    CHUNK,
  );
  for (const chunk of chunks) {
    const [worn, tagged] = await db().batch([
      garmentsWornIn(chunk, itemIds),
      tagsUsedIn(chunk),
    ]);
    for (const row of worn) {
      // Neither lookup can miss — the SQL is scoped to these entries and
      // these items — so they fall back rather than branch. A guard that
      // skipped a missing row would be a branch no input can reach.
      const record = garments.get(row.itemId) ?? recordFor(row.itemId);
      const verdict = verdictOf.get(row.entryId) ?? 0;
      record.total += 1;
      if (verdict < 0) record.colder += 1;
      else if (verdict > 0) record.warmer += 1;
      else record.dialed += 1;
    }
    for (const row of tagged) {
      tagUse[row.tag] = (tagUse[row.tag] ?? 0) + 1;
    }
  }

  return { garments: Object.fromEntries(garments), tagUse };
}

/**
 * The signals for one entry's own kit, as A3 asks for them.
 *
 * The kit is read here, scoped to the owner **in SQL**, rather than passed
 * in: a route may not `.map(` (it must stay glue), and a caller-supplied
 * list of item ids would let anyone ask for the band record of garments
 * that are not theirs. Someone else's entry reads as a kit of nothing. The
 * entry itself is left out of its own record — it is the one being judged.
 */
export async function bandSignalsForEntry(
  userId: string,
  entryId: string,
  bandFloorC: number,
): Promise<BandSignals> {
  const kit = await db()
    .select({ itemId: outfitEntryItems.itemId })
    .from(outfitEntryItems)
    .innerJoin(outfitEntries, eq(outfitEntries.id, outfitEntryItems.entryId))
    .where(
      and(
        eq(outfitEntryItems.entryId, entryId),
        eq(outfitEntries.userId, userId),
      ),
    );
  return bandSignals(
    userId,
    bandFloorC,
    kit.map((row) => row.itemId),
    entryId,
  );
}
