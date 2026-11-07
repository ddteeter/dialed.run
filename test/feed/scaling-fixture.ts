/**
 * The world feed's scaling tests seed (design 182): runs that all share
 * one cache cell and one hour, so the weather side is one observation
 * however many runs there are, and the formula below is all that grows.
 */
import { IN_LIST_CHUNK } from "../../src/lib/chunked";
import { CELLS_PER_ROW_READ } from "../../src/modules/weather/read";
import { makeEntry, makeObservation, makeRun, NOW } from "./helpers";

export const HOUR = 3600;
export const DAY = 24 * HOUR;

/**
Where and when every seeded run is, and what it felt like there.
*/
export const PLACE = { lat: 44.98, lng: -93.27 };
export const FEELS_LIKE_C = 7;
/**
The 5 °C band `FEELS_LIKE_C` falls in (`bandFloorC`).
*/
export const BAND_FLOOR_C = 5;

/**
 * What `observationsForEntries` (src/modules/feed/conditions.ts:86) asks
 * for `entries` located one-hour runs: their runs in `IN_LIST_CHUNK`
 * chunks on core; on weather, the cache cells in chunks of
 * `CELLS_PER_ROW_READ` (one cell per run, not de-duplicated:
 * src/modules/feed/conditions.ts:142) and the runs' own bands in
 * `IN_LIST_CHUNK` chunks (`manualBandsFor`, src/modules/weather/store.ts:279).
 * The weather side legitimately scales with the window; it is chunked,
 * not per row.
 */
export function observationWalk(entries: number): {
  core: number;
  weather: number;
} {
  const inLists = Math.ceil(entries / IN_LIST_CHUNK);
  return {
    core: inLists,
    weather: Math.ceil(entries / CELLS_PER_ROW_READ) + inLists,
  };
}

/**
 * A located run of under an hour at `PLACE`, `ago` seconds before NOW,
 * its entry, and nothing on the weather side: `seedObservation` writes the
 * one observation every run shares.
 */
export async function seedEntry(params: {
  userId: string;
  itemIds?: string[];
  verdict?: number;
  ago?: number;
}): Promise<string> {
  const at = NOW - (params.ago ?? HOUR);
  const runId = await makeRun({
    userId: params.userId,
    ...PLACE,
    startedAt: at,
    durationS: 60,
  });
  return makeEntry({
    userId: params.userId,
    runId,
    createdAt: at,
    verdict: params.verdict ?? 0,
    itemIds: params.itemIds ?? [],
  });
}

/**
The one observation at `PLACE`, `ago` seconds before NOW.
*/
export async function seedObservation(ago = HOUR): Promise<void> {
  await makeObservation({
    ...PLACE,
    startedAt: NOW - ago,
    tempC: 8,
    feelsLikeC: FEELS_LIKE_C,
  });
}
