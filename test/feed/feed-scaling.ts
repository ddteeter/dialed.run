/**
 * What the feed module's scaling tests share (design 182): a measured
 * read on a clean slate, the "same statements, more rows" assertion, and
 * a located entry on the one cell `seedObservation()` fills.
 */
import { drizzle } from "drizzle-orm/d1";
import { expect } from "vitest";

import { entryPhotos } from "../../src/db/schema-core";
import { env } from "../../src/env";
import type { Audience } from "../../src/lib/contracts";
import { queryCounts } from "../d1-spy";
import type { QueryCounts } from "../d1-spy";
import { deleteAllFrom, makeEntry, makeRun, NOW, resetTables } from "./helpers";
import { HOUR, PLACE } from "./scaling-fixture";

/**
Every seeded run starts here: under an hour, at `PLACE`, the cell `seedObservation()` fills.
*/
export const STARTED = NOW - HOUR;

export function core() {
  return drizzle(env.DIALED_CORE);
}

/**
 * A clean slate, the world `seed` builds for `size`, and what the read it
 * hands back asked of each database. The seeding is not counted.
 */
export async function measured<T>(
  size: number,
  seed: (size: number) => Promise<() => Promise<T>>,
): Promise<{ counts: QueryCounts; result: T }> {
  await resetTables();
  await deleteAllFrom(core(), [entryPhotos]);
  const read = await seed(size);
  const results: T[] = [];
  const counts = await queryCounts(async () => {
    results.push(await read());
  });
  const [result] = results;
  if (result === undefined) throw new Error("the read never answered");
  return { counts, result };
}

/**
The same statements on both databases, and more rows read: the seed reached the query.
*/
export function expectFlat(one: QueryCounts, many: QueryCounts): void {
  expect(many.core).toBe(one.core);
  expect(many.weather).toBe(one.weather);
  expect(many.coreRowsRead).toBeGreaterThan(one.coreRowsRead);
}

/**
A located run at `PLACE` and its entry, `index` seconds newer than the last.
*/
export async function locatedEntry(params: {
  userId: string;
  index: number;
  itemIds?: string[];
  verdict?: number;
  audience?: Audience;
}): Promise<string> {
  const runId = await makeRun({
    userId: params.userId,
    ...PLACE,
    startedAt: STARTED,
    durationS: 60,
  });
  return makeEntry({
    userId: params.userId,
    runId,
    createdAt: STARTED + params.index,
    verdict: params.verdict ?? 0,
    itemIds: params.itemIds ?? [],
    audience: params.audience ?? "runners",
  });
}
