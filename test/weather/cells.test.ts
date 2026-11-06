import { drizzle } from "drizzle-orm/d1";
import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { manualConditions } from "../../src/db/schema-weather";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  forgetManualBands,
  newestObservationAt,
  observationsAtCells,
} from "../../src/modules/weather";
import type { CacheKey } from "../../src/modules/weather";
import { upsertRealObservation } from "../../src/modules/weather/store";

/**
 * The reads and the delete other modules reach `dialed-weather` through
 * (design 173): feed's conditions and the account purge used to touch
 * these tables themselves.
 */

const weather = drizzle(env.DIALED_WEATHER);

async function plant(key: CacheKey, tempC: number): Promise<void> {
  await upsertRealObservation(key, {
    tempC,
    feelsLikeC: tempC,
    humidity: 50,
    windKph: 5,
    precipMm: 0,
    condition: "clear",
  });
}

async function bandsOf(runIds: readonly string[]) {
  return weather
    .select({ runId: manualConditions.runId })
    .from(manualConditions)
    .where(inArray(manualConditions.runId, [...runIds]));
}

function temps(rows: readonly { tempC: number }[]): number[] {
  return rows.map((row) => row.tempC).toSorted((a, b) => a - b);
}

describe("observationsAtCells", () => {
  it("answers nothing for no cells", async () => {
    expect(await observationsAtCells([])).toStrictEqual([]);
  });

  it("returns exactly the asked cells, never a neighbour in place or hour", async () => {
    const asked = { latR: 61.11, lngR: 21.11, hourBucket: 490_000 };
    await plant(asked, 7);
    await plant({ ...asked, hourBucket: asked.hourBucket + 1 }, 8);
    await plant({ ...asked, lngR: 21.12 }, 9);
    await plant({ ...asked, latR: 61.12 }, 10);

    const rows = await observationsAtCells([asked]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ...asked, tempC: 7 });
  });

  it("returns every cell past one read's worth, and skips cells never fetched", async () => {
    // Three parameters a cell: unchunked, 45 cells is past D1's hundred.
    const keys = Array.from({ length: 45 }, (_unused, index) => ({
      latR: 62.11,
      lngR: 22.11,
      hourBucket: 491_000 + index,
    }));
    for (const [index, key] of keys.entries()) await plant(key, index);
    const never = { latR: 62.11, lngR: 22.11, hourBucket: 492_000 };

    const rows = await observationsAtCells([...keys, never]);

    expect(temps(rows)).toStrictEqual(keys.map((_key, index) => index));
  });
});

describe("newestObservationAt", () => {
  it("is undefined when none of the cells was fetched", async () => {
    expect(
      await newestObservationAt([
        { latR: 63.11, lngR: 23.11, hourBucket: 493_000 },
      ]),
    ).toBeUndefined();
  });

  it("answers the latest hour among the cells, whatever order they come in", async () => {
    const place = { latR: 64.11, lngR: 24.11 };
    await plant({ ...place, hourBucket: 494_000 }, 1);
    await plant({ ...place, hourBucket: 494_001 }, 2);
    // Newer still, but not asked about.
    await plant({ ...place, hourBucket: 494_002 }, 3);

    const newest = await newestObservationAt([
      { ...place, hourBucket: 494_000 },
      { ...place, hourBucket: 494_001 },
    ]);

    expect(newest).toMatchObject({ hourBucket: 494_001, tempC: 2 });
  });
});

describe("forgetManualBands", () => {
  it("deletes every band the runs carry, past one statement's worth, and only theirs", async () => {
    const theirs = Array.from({ length: 90 }, () => newUlid());
    const kept = newUlid();
    for (const runId of [...theirs, kept]) {
      await weather
        .insert(manualConditions)
        .values({ runId, tempC: 3, setAt: 1_768_500_000 });
    }

    await forgetManualBands(theirs);

    expect(await bandsOf(theirs.slice(0, 80))).toStrictEqual([]);
    expect(await bandsOf(theirs.slice(80))).toStrictEqual([]);
    expect(await bandsOf([kept])).toStrictEqual([{ runId: kept }]);
  });

  it("is re-runnable: forgetting bands already gone deletes nothing", async () => {
    const kept = newUlid();
    await weather
      .insert(manualConditions)
      .values({ runId: kept, tempC: 3, setAt: 1_768_500_000 });

    await forgetManualBands([newUlid()]);
    await forgetManualBands([]);

    expect(await bandsOf([kept])).toStrictEqual([{ runId: kept }]);
  });
});
