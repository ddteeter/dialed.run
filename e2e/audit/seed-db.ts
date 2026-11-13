/**
 * Writes the audit's dense seed to the local D1 databases and R2 (design
 * 205, "Seeded data"). Glue: every row comes from `buildDenseSeed`, which
 * is pure and tested; this file only batches inserts, clears what an
 * earlier seed left, and puts the drawn photos.
 *
 * Re-runnable: every row it writes is owned by an `audit-` user or has an
 * `audit-` id, and `cleanAudit` clears them first. Review-queue rows have
 * minted ids, so the last seed's are kept beside its summary.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type { Page } from "@playwright/test";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { eq, inArray, sql } from "drizzle-orm";
import { getPlatformProxy } from "wrangler";
import { z } from "zod";

import { user } from "../../src/db/schema-auth";
import { reviewQueue, runs, userProfiles } from "../../src/db/schema-core";
import {
  manualConditions,
  weatherObservations,
} from "../../src/db/schema-weather";
import { nowSeconds } from "../../src/lib/now";
import { withLocalDb } from "../support/local-db";
import { deleteWhereLike, inBatches, insertsFor } from "./batching";
import {
  MAYA,
  MAYA_ID,
  auditSeedSchema,
  buildDenseSeed,
  type AuditSeed,
  type WeatherRows,
} from "./dense-seed";
import { renderPhotos } from "./photos";
import { coreTables } from "./tables";

const OUT_DIR = "node_modules/.cache/dialed-audit";
const OUT = `${OUT_DIR}/seed.json`;

const storedSeed = z.strictObject({
  seed: auditSeedSchema,
  queueIds: z.array(z.string()),
});

function readStored(): z.infer<typeof storedSeed> {
  const parsed: unknown = JSON.parse(readFileSync(OUT, "utf8"));
  return storedSeed.parse(parsed);
}

/**
What the last `seedAudit` left: the ids a spec visits.
*/
export function readSeed(): AuditSeed {
  return readStored().seed;
}

function lastQueueIds(): string[] {
  try {
    return readStored().queueIds;
  } catch {
    // No earlier seed, or one from before the queue ids were kept.
    return [];
  }
}

export async function cleanAudit(): Promise<void> {
  const queueIds = lastQueueIds();
  await withLocalDb(async ({ core, weather }) => {
    const mine = sql.raw(
      `(select id from outfit_entries where user_id like 'audit-%')`,
    );
    const myRuns = await core
      .select({ id: runs.id })
      .from(runs)
      .where(sql`${runs.userId} like 'audit-%'`);
    const runIds = myRuns.map((row) => row.id);
    const weatherStatements: BatchItem<"sqlite">[] = [
      weather
        .delete(weatherObservations)
        .where(sql`${weatherObservations.id} like 'audit-%'`),
    ];
    for (let index = 0; index < runIds.length; index += 50) {
      const chunk = runIds.slice(index, index + 50);
      weatherStatements.push(
        weather
          .delete(manualConditions)
          .where(inArray(manualConditions.runId, chunk)),
      );
    }
    await inBatches(weather, weatherStatements);
    const statements: BatchItem<"sqlite">[] = [
      core.run(sql`delete from outfit_entry_items where entry_id in ${mine}`),
      core.run(sql`delete from entry_tags where entry_id in ${mine}`),
      core.run(sql`delete from entry_photos where entry_id in ${mine}`),
      core.run(
        sql`delete from reactions where entry_id in ${mine} or user_id like 'audit-%'`,
      ),
      ...deleteWhereLike(
        core,
        "user_id",
        ["outfit_entries", "run_conditions", "runs", "wardrobe_items"],
        "audit-%",
      ),
      core.run(
        sql`delete from follows where follower_id like 'audit-%' or followee_id like 'audit-%'`,
      ),
      core.run(
        sql`delete from follow_notices where follower_id like 'audit-%' or followee_id like 'audit-%'`,
      ),
      core.run(sql`delete from notifications where user_id like 'audit-%'`),
      core.run(sql`delete from product_corrections where id like 'audit-%'`),
      core.run(sql`delete from products where created_by like 'audit-%'`),
      core.run(sql`delete from brands where normalized like '% audit'`),
      ...deleteWhereLike(
        core,
        "id",
        ["reports", "review_queue", "gave_up", "moderation_actions"],
        "audit-%",
      ),
      ...deleteWhereLike(
        core,
        "user_id",
        ["account_deletions", "invite_redemptions"],
        "audit-%",
      ),
      ...deleteWhereLike(
        core,
        "id",
        ["invite_codes", "access_requests"],
        "audit-%",
      ),
      core.run(
        sql`delete from user_profiles where user_id like 'audit-%' and user_id != ${MAYA_ID}`,
      ),
      core.run(
        sql`delete from user where id like 'audit-%' and id != ${MAYA_ID}`,
      ),
      ...queueIds.map((id) =>
        core.delete(reviewQueue).where(eq(reviewQueue.id, id)),
      ),
    ];
    await inBatches(core, statements);
  });
}

/**
Maya's profile, as onboarding and Settings would have left it.
*/
export async function settleMaya(): Promise<void> {
  await withLocalDb(async ({ core }) => {
    await core.batch([
      core
        .update(userProfiles)
        .set({
          cityLabel: MAYA.city,
          lat: MAYA.lat,
          lng: MAYA.lng,
          timeZone: MAYA.timeZone,
          tempUnit: "f",
          distanceUnit: "mi",
          thermalLevel: 0,
          onboardingComplete: true,
          publicProfile: true,
          publicCloset: true,
          usernameScreen: "clear",
        })
        .where(eq(userProfiles.userId, MAYA_ID)),
      core.update(user).set({ name: MAYA.name }).where(eq(user.id, MAYA_ID)),
    ]);
  });
}

/**
 * Weather readings are shared by place and hour with whatever else seeded
 * this database, so a reading that is already there takes the seed's values.
 */
function weatherInserts(
  db: DrizzleD1Database,
  rows: WeatherRows,
): BatchItem<"sqlite">[] {
  return [
    ...rows.observations.map((row) =>
      db
        .insert(weatherObservations)
        .values(row)
        .onConflictDoUpdate({
          target: [
            weatherObservations.latR,
            weatherObservations.lngR,
            weatherObservations.hourBucket,
          ],
          set: {
            tempC: row.tempC,
            feelsLikeC: row.feelsLikeC,
            humidity: row.humidity,
            windKph: row.windKph,
            precipMm: row.precipMm,
            condition: row.condition,
          },
        }),
    ),
    ...rows.manual.map((row) => db.insert(manualConditions).values(row)),
  ];
}

/**
 * Seeds the dense data and returns what the specs visit. Takes a page
 * because the photos are drawn on a canvas in it; call `cleanAudit` first.
 */
export async function seedAudit(page: Page): Promise<AuditSeed> {
  const seed = buildDenseSeed(nowSeconds());
  await withLocalDb(async ({ core, weather }) => {
    await inBatches(core, insertsFor(core, coreTables, seed.core));
    await inBatches(weather, weatherInserts(weather, seed.weather));
  });
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      { seed: seed.summary, queueIds: seed.queueIds },
      undefined,
      2,
    ),
  );

  const photos = await renderPhotos(page, seed.objects);
  const media = await getPlatformProxy<Env>();
  try {
    for (const object of seed.objects) {
      const bytes = photos.get(object.key);
      if (bytes === undefined)
        throw new Error(`no photo drawn for ${object.key}`);
      await media.env.MEDIA.put(object.key, bytes, {
        httpMetadata: { contentType: object.contentType },
      });
    }
  } finally {
    await media.dispose();
  }
  return seed.summary;
}

export { MAYA_HANDLE, MAYA_ID, type AuditSeed } from "./dense-seed";
