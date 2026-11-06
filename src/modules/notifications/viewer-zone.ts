/**
 * The zone a signed-in runner's own times read in — their notifications,
 * their rate limits, their export's expiry and their deletion day (R-96
 * (3); owner ruling 2026-11-05, confirmed in Design round 46, 107a–b).
 *
 * The home place's zone (`user_profiles.time_zone`, design 142), and
 * nothing else: not a run's zone, which is onboarding's `runnerTimeZone`
 * fallback and right for a day boundary but wrong for "what time is it
 * where you live"; not a cookie; not the browser. NULL means the lookup is
 * still owed, and the formatters mark the UTC they fall back to.
 *
 * Here rather than in onboarding, which owns the column's writers: account
 * needs this read, and account → onboarding → feed → account is a cycle.
 * Notifications imports neither, so both can reach it.
 */
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";
import { homeZoneOf } from "../../lib/dates";
import type { ViewerZone } from "../../lib/dates";
import { firstColumnWhere } from "../../lib/sql/keyed-read";

export async function viewerZone(
  db: DrizzleD1Database<Record<string, unknown>>,
  userId: string,
): Promise<ViewerZone> {
  return homeZoneOf(
    await firstColumnWhere(
      db,
      userProfiles,
      userProfiles.timeZone,
      eq(userProfiles.userId, userId),
    ),
  );
}
