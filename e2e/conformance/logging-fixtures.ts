import { eq, inArray } from "drizzle-orm";
import type { Page } from "@playwright/test";

import { user } from "../../src/db/schema-auth";
import {
  imports,
  outfitEntries,
  outfitEntryItems,
  runs,
  wardrobeItems,
} from "../../src/db/schema-core";
import { weatherObservations } from "../../src/db/schema-weather";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { accountEmail } from "../support/accounts";
import type { DemoAccount } from "../support/accounts";
import { withLocalDb } from "../support/local-db";

/**
 * What the logging lane's conformance specs seed: a run in the boards' own
 * shape — 6.2 miles in 51:38, on a damp 41°F morning — so a region's words
 * can be compared to the drawing's without the fake data getting in the
 * way. One place for it, because four specs want the same run.
 */

/**
 * 2026-08-29 11:04 UTC: 6:04 AM in Chicago, the boards' own morning. Far
 * enough back that nothing another journey logs lands within the ±120s a
 * duplicate is found by.
 */
export const BOARD_MORNING = Math.floor(Date.UTC(2026, 7, 29, 11, 4) / 1000);

/**
6.2 miles, and 51:38 — A1's "6.2 MI · 51:38".
*/
export const BOARD_DISTANCE_M = 9978;
export const BOARD_DURATION_S = 3098;

const LAT = 44.98;
const LNG = -93.27;

/**
Everything a spec seeded, so it can take it all back out.
*/
export interface Seeded {
  userId: string;
  runIds: string[];
  itemIds: string[];
  entryIds: string[];
}

export async function userIdOf(account: DemoAccount): Promise<string> {
  return withLocalDb(async ({ core }) => {
    const [row] = await core
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, accountEmail(account)))
      .limit(1);
    if (!row) throw new Error(`no ${account} account — demo-setup did not run`);
    return row.id;
  });
}

/**
 * A run on the board's morning. `observed` adds its weather — 5 °C with a
 * millimetre of rain, which reads "41°F DAMP" — in Chicago's zone.
 */
export async function seedRun(
  seeded: Seeded,
  options: {
    observed: boolean;
    weatherStatus: "attached" | "failed" | "pending";
    startedAt?: number;
  },
): Promise<string> {
  const runId = newUlid();
  const startedAt = options.startedAt ?? BOARD_MORNING;
  await withLocalDb(async ({ core, weather }) => {
    await core.insert(runs).values({
      id: runId,
      userId: seeded.userId,
      title: "Conformance",
      startedAt,
      durationS: BOARD_DURATION_S,
      distanceM: BOARD_DISTANCE_M,
      source: "file",
      indoor: false,
      lat: LAT,
      lng: LNG,
      weatherStatus: options.weatherStatus,
    });
    if (!options.observed) return;
    const hourBucket = Math.floor(startedAt / 3600);
    await weather
      .insert(weatherObservations)
      .values({
        id: newUlid(),
        runId,
        latR: LAT,
        lngR: LNG,
        hourBucket,
        tempC: 5,
        feelsLikeC: 2,
        humidity: 88,
        windKph: 14,
        precipMm: 1,
        condition: "light rain",
        timeZone: "America/Chicago",
        source: "visualcrossing",
        fetchedAt: nowSeconds(),
      })
      .onConflictDoNothing();
  });
  seeded.runIds.push(runId);
  return runId;
}

export async function seedItem(
  seeded: Seeded,
  name: string,
  category: "top" | "bottom",
): Promise<string> {
  const itemId = newUlid();
  await withLocalDb(async ({ core }) => {
    await core.insert(wardrobeItems).values({
      id: itemId,
      userId: seeded.userId,
      name,
      category,
      createdAt: nowSeconds(),
    });
  });
  seeded.itemIds.push(itemId);
  return itemId;
}

/**
 * An entry on one of the seeded runs, with its kit — the shape A3 opens.
 */
export async function seedEntry(
  seeded: Seeded,
  runId: string,
  itemIds: readonly string[],
): Promise<string> {
  const entryId = newUlid();
  await withLocalDb(async ({ core }) => {
    await core.insert(outfitEntries).values({
      id: entryId,
      userId: seeded.userId,
      runId,
      isPublic: false,
      createdAt: nowSeconds(),
    });
    if (itemIds.length > 0) {
      await core
        .insert(outfitEntryItems)
        .values(itemIds.map((itemId) => ({ entryId, itemId })));
    }
  });
  seeded.entryIds.push(entryId);
  return entryId;
}

/**
 * Takes out what the spec seeded, and the runs its imports made, so the
 * next run of the spec starts clean. Only those: the account is shared
 * with a demo whose rows are not this spec's to delete.
 */
export async function unseed(seeded: Seeded): Promise<void> {
  await withLocalDb(async ({ core, weather }) => {
    const imported = await core
      .select({ runId: imports.runId })
      .from(imports)
      .where(eq(imports.userId, seeded.userId));
    const runIds = [
      ...new Set([
        ...seeded.runIds,
        ...imported.flatMap((row) => (row.runId === null ? [] : [row.runId])),
      ]),
    ];
    await core.delete(imports).where(eq(imports.userId, seeded.userId));
    const entries =
      runIds.length === 0
        ? []
        : await core
            .select({ id: outfitEntries.id })
            .from(outfitEntries)
            .where(inArray(outfitEntries.runId, runIds));
    const entryIds = [
      ...new Set([...seeded.entryIds, ...entries.map((row) => row.id)]),
    ];
    if (entryIds.length > 0) {
      await core
        .delete(outfitEntryItems)
        .where(inArray(outfitEntryItems.entryId, entryIds));
      await core
        .delete(outfitEntries)
        .where(inArray(outfitEntries.id, entryIds));
    }
    if (runIds.length > 0) {
      await core.delete(runs).where(inArray(runs.id, runIds));
    }
    if (seeded.itemIds.length > 0) {
      await core
        .delete(wardrobeItems)
        .where(inArray(wardrobeItems.id, seeded.itemIds));
    }
    await weather
      .delete(weatherObservations)
      .where(
        eq(weatherObservations.hourBucket, Math.floor(BOARD_MORNING / 3600)),
      );
  });
}

/**
Waits for React to attach, which every control on these screens needs.
*/
export async function hydrated(page: Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

/**
 * A region's fill, its frame (the top edge) and the rule beneath it — the
 * things that tell a card from a row, a mark from a rest.
 *
 * **A border of no width is no border.** Tailwind's preflight gives every
 * element `border-style: solid` at width 0, so the computed style says
 * "solid" on edges nothing is drawn on; the board's inline styles say
 * "none". Width decides, so the two read alike.
 */
export async function lookOf(
  page: Page,
  selector: string,
): Promise<{
  fill: string;
  borderStyle: string;
  borderColor: string;
  ruleBelow: string;
}> {
  return page.$eval(selector, (element) => {
    const style = getComputedStyle(element);
    return {
      fill: style.backgroundColor,
      borderStyle:
        style.borderTopWidth === "0px" ? "none" : style.borderTopStyle,
      borderColor: style.borderTopColor,
      ruleBelow:
        style.borderBottomWidth === "0px" ? "none" : style.borderBottomStyle,
    };
  });
}
