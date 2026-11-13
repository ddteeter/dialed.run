/**
 * Writes the gaps seed (design 205): the states the dense seed does not
 * reach. Glue: the rows come from `planGaps` and `nowhereObservations`,
 * which are pure and tested; this reads what the dense seed left, clears
 * what an earlier run left, and batches the writes.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  entryPhotos,
  outfitEntries,
  runs,
  userProfiles,
} from "../../src/db/schema-core";
import { weatherObservations } from "../../src/db/schema-weather";
import { nowSeconds } from "../../src/lib/now";
import { deleteWhereLike, inBatches, insertsFor } from "./batching";
import { note } from "./capture";
import { MAYA_ID } from "./dense-seed";
import {
  NOWHERE,
  nowhereObservations,
  planGaps,
  type GapSeed,
} from "./gaps-plan";
import { gapTables } from "./tables";
import { withLocalDb } from "../support/local-db";

export {
  EMPTY_HANDLE,
  EMPTY_ID,
  NOWHERE,
  ONBOARD_HANDLE,
  ONBOARD_ID,
} from "./gaps-plan";
export type { GapSeed } from "./gaps-plan";

/**
Everything a brand-new runner could have left behind on an earlier run.
*/
export async function resetRunner(userId: string): Promise<void> {
  await withLocalDb(async ({ core }) => {
    const mine = sql`(select id from outfit_entries where user_id = ${userId})`;
    for (const statement of [
      sql`delete from outfit_entry_items where entry_id in ${mine}`,
      sql`delete from entry_tags where entry_id in ${mine}`,
      sql`delete from entry_photos where entry_id in ${mine}`,
      sql`delete from outfit_entries where user_id = ${userId}`,
      sql`delete from run_conditions where user_id = ${userId}`,
      sql`delete from runs where user_id = ${userId}`,
      sql`delete from wardrobe_items where user_id = ${userId}`,
      sql`delete from follows where follower_id = ${userId} or followee_id = ${userId}`,
      sql`delete from notifications where user_id = ${userId}`,
      sql`delete from strava_connections where user_id = ${userId}`,
      sql`delete from imports where user_id = ${userId}`,
    ]) {
      // One at a time on purpose: a table an older database lacks skips
      // that statement rather than the whole reset.
      try {
        await core.run(statement);
      } catch (error) {
        note(`reset skipped a statement: ${String(error)}`);
      }
    }
  });
}

/**
The profile a runner past onboarding has, with or without a place.
*/
export async function settleRunner(
  userId: string,
  place: { cityLabel: string; lat: number; lng: number } | undefined,
  isOnboarded = true,
): Promise<void> {
  await withLocalDb(async ({ core }) => {
    await core
      .update(userProfiles)
      .set({
        cityLabel: place?.cityLabel ?? sql`NULL`,
        lat: place?.lat ?? sql`NULL`,
        lng: place?.lng ?? sql`NULL`,
        tempUnit: "f",
        distanceUnit: "mi",
        onboardingComplete: isOnboarded,
        usernameScreen: "clear",
      })
      .where(eq(userProfiles.userId, userId));
  });
}

/**
A reading at the brand-new runner's place, far from every seeded run.
*/
export async function observeNowhere(feelsLikeC: number): Promise<void> {
  const rows = nowhereObservations(nowSeconds(), feelsLikeC);
  const sameCells = and(
    eq(weatherObservations.latR, NOWHERE.lat),
    eq(weatherObservations.lngR, NOWHERE.lng),
    inArray(
      weatherObservations.hourBucket,
      rows.map((row) => row.hourBucket),
    ),
  );
  await withLocalDb(async ({ weather }) => {
    await weather.batch([
      weather
        .delete(weatherObservations)
        .where(sql`${weatherObservations.id} like 'audit-gobs%'`),
      weather.delete(weatherObservations).where(sameCells),
      ...rows.map((row) => weather.insert(weatherObservations).values(row)),
    ]);
  });
}

export async function cleanGaps(): Promise<void> {
  await withLocalDb(async ({ core }) => {
    await core.batch([
      core.run(
        sql`delete from blocks where blocker_id = ${MAYA_ID} or blocked_id like 'audit-g%'`,
      ),
      ...deleteWhereLike(
        core,
        "id",
        [
          "takedown_requests",
          "copyright_holds",
          "quarantined_content",
          "moderation_actions",
          "review_queue",
          "entry_photos",
        ],
        "audit-g%",
      ),
      core.run(sql`delete from strava_connections where user_id = ${MAYA_ID}`),
      core.run(sql`delete from user_profiles where user_id like 'audit-gb%'`),
      core.run(sql`delete from user where id like 'audit-gb%'`),
    ]);
  });
}

const OUT_DIR = "node_modules/.cache/dialed-audit";
const OUT = `${OUT_DIR}/gaps.json`;

const gapSeedSchema = z.strictObject({
  failedRunId: z.string(),
  pendingRunId: z.string(),
  matchPhotoId: z.string(),
  takedownEntryId: z.string(),
});

/**
What the last `seedGaps` left: the ids a spec visits.
*/
export function readGaps(): GapSeed {
  const parsed: unknown = JSON.parse(readFileSync(OUT, "utf8"));
  return gapSeedSchema.parse(parsed);
}

/**
 * Seeds the gaps over the dense seed (run that first), keeps the summary
 * for `readGaps`, and returns it.
 */
export async function seedGaps(): Promise<GapSeed> {
  const seed = await writeGaps();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, JSON.stringify(seed, undefined, 2));
  return seed;
}

async function writeGaps(): Promise<GapSeed> {
  await cleanGaps();
  const sharedByOthers = and(
    sql`${outfitEntries.userId} like 'audit-r%'`,
    eq(entryPhotos.screenStatus, "pass"),
  );
  return withLocalDb(async ({ core }) => {
    const photoColumns = {
      id: entryPhotos.id,
      entryId: entryPhotos.entryId,
      photoKey: entryPhotos.photoKey,
      ownerId: outfitEntries.userId,
    };
    const [mayaRuns, photos, usernames] = await core.batch([
      core
        .select({ id: runs.id, weatherStatus: runs.weatherStatus })
        .from(runs)
        .where(eq(runs.userId, MAYA_ID)),
      // The Desk: other runners' shared photos, as the dense seed left them.
      core
        .select(photoColumns)
        .from(entryPhotos)
        .innerJoin(outfitEntries, eq(outfitEntries.id, entryPhotos.entryId))
        .where(sharedByOthers)
        .limit(60),
      core
        .select({
          userId: userProfiles.userId,
          username: userProfiles.username,
        })
        .from(userProfiles)
        .where(sql`${userProfiles.userId} like 'audit-r%'`),
    ]);
    const { rows, seed } = planGaps({
      now: nowSeconds(),
      photos,
      usernames: new Map(
        usernames.flatMap((row) =>
          row.username === null ? [] : [[row.userId, row.username] as const],
        ),
      ),
      mayaRuns,
    });
    await inBatches(core, insertsFor(core, gapTables, rows));
    return seed;
  });
}
