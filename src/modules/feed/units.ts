import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";
import {
  defaultUnits,
  distanceUnitSchema,
  tempUnitSchema,
} from "../../lib/contracts";
import type { Units } from "../../lib/contracts";

/**
 * The units this person reads their own data in.
 *
 * `user_profiles.temp_unit` and `.distance_unit` have existed since the
 * schema was written and nothing read them, so every temperature rendered
 * in Fahrenheit and every distance in miles whatever the row said (D-6).
 * The work was never a formatter — it was this read, and carrying the
 * answer to the four places that format.
 *
 * **Parsed, not cast.** Drizzle types these columns from the enum in the
 * schema, but the row is still data from outside this process, and a value
 * written before a vocabulary changed would arrive as a string the type
 * says is impossible. A column that fails to parse falls back rather than
 * throwing: a stale unit is a cosmetic problem, and refusing to render the
 * feed over one would be the secondary failure taking the primary action
 * down (resilience law 5).
 *
 * A signed-out viewer, or one with no profile row yet, gets the defaults.
 */
export async function unitsFor(
  database: DrizzleD1Database,
  userId: string | undefined,
): Promise<Units> {
  if (userId === undefined) return defaultUnits;

  const [row] = await database
    .select({
      temp: userProfiles.tempUnit,
      distance: userProfiles.distanceUnit,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  if (row === undefined) return defaultUnits;

  const temp = tempUnitSchema.safeParse(row.temp);
  const distance = distanceUnitSchema.safeParse(row.distance);
  return {
    temp: temp.success ? temp.data : defaultUnits.temp,
    distance: distance.success ? distance.data : defaultUnits.distance,
  };
}
