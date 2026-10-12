import type { DrizzleD1Database } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";
import type { Region } from "../../lib/contracts/regions";
import { orSqlNull } from "../../lib/sql/sql-null";
import type { CountInTotalsChoice } from "./inputs";

/**
 * The two settings that shape what a runner adds to published anonymous
 * totals (D-108): whether their runs count at all, and the region a total
 * may group them under. One writer each, and nothing else writes these
 * columns. Both are reached through `verifiedUserId()` (D-113), because
 * what they change is published.
 *
 * Upserts for `saveCalibration`'s reason — nothing at signup creates the
 * profile row — and each `set` names only its own columns, so neither can
 * reset the other, a calibration or the sharing default.
 */

/**
 * Settings › Sharing's switch (D-108 D). Off takes effect at the next
 * nightly build of the guides; published reports stay as they are. That
 * is the guide job's to honour, not this writer's.
 */
export async function setCountInTotals(
  db: DrizzleD1Database,
  userId: string,
  { countInTotals }: CountInTotalsChoice,
): Promise<CountInTotalsChoice> {
  await db
    .insert(userProfiles)
    .values({ userId, countInTotals })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: { countInTotals },
    });
  return { countInTotals };
}

/**
 * Settings › Region (round 30 (d)): both columns written together, so a
 * new country never keeps the old country's subdivision, and neither
 * clears it. `regionInput` has already refused a subdivision without its
 * country.
 *
 * **An absent part is written as NULL** (`orSqlNull`), never left out:
 * drizzle drops an `undefined` key from `set`, so a clear would otherwise
 * change nothing, and a country alone would keep the last state.
 */
export async function setRegion(
  db: DrizzleD1Database,
  userId: string,
  region: Region,
): Promise<Region> {
  const columns = {
    regionCountry: orSqlNull(region.country),
    regionSubdivision: orSqlNull(region.subdivision),
  };
  await db
    .insert(userProfiles)
    .values({ userId, ...columns })
    .onConflictDoUpdate({ target: userProfiles.userId, set: columns });
  return region;
}
