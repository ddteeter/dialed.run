/**
 * A run's conditions, derived from the weather cache and the runner's own
 * band: the starting hour's reading and the span over every hour it
 * touched. Moved here from `feed/conditions.ts` (design 189) so the
 * weather module can build the copy of a run's conditions it writes to
 * core (`run_conditions`, D-175) from the same derivation the feed reads,
 * rather than a second copy of it. `feed` imports `weather`, never the
 * reverse, so the derivation lives on this side.
 */
import { isTimeZone } from "../../lib/dates";
import { pointSpan } from "../../lib/contracts";
import type { Conditions } from "../../lib/contracts";
import { manualReadingsForRuns, observationsAtCells } from "./read";
import { runHourKeys } from "./store";
import type { ObservationRow } from "./store";

/**
One observation cache cell, as a Map key.
*/
function cellKey(latR: number, lngR: number, hourBucket: number): string {
  return `${String(latR)}|${String(lngR)}|${String(hourBucket)}`;
}

export interface Locatable {
  id: string;
  lat: number | null;
  lng: number | null;
  startedAt: number;
  /** How far past `startedAt` to read. Without it a 2-hour run reads as
   *  the hour it began in, which is R-5. */
  durationS: number;
}

/**
 * A stored zone as a field to spread, present only if this runtime's
 * `Intl` accepts it (R-96). The column is text written from a third
 * party's response; checked again here so an unusable one can never reach
 * a formatter and throw at render time.
 *
 * A field to spread rather than `timeZone: undefined`, so conditions with
 * no zone are exactly the object they were before the column existed —
 * the difference `toStrictEqual` sees, and so does anything that
 * serialises the object.
 */
export function zoneField(stored: string | null): { timeZone?: string } {
  return isTimeZone(stored) ? { timeZone: stored } : {};
}

/**
 * Resolve observations for a batch of runs via cache-key index seeks, plus
 * each run's own band.
 *
 * **A band belongs to its run only** (B1). It is read by run id, never by
 * cell, and it wins over the cell for that run — it is what the runner
 * chose for it. A legacy `source='manual'` row still in the cache is
 * somebody's band, not the weather, so the cell read skips it. Bands come
 * back tagged `manual`; callers that aggregate (consensus, coverage) must
 * exclude them — per-run display may show them.
 */
export async function conditionsForRuns(
  batch: readonly Locatable[],
): Promise<Map<string, Conditions>> {
  // Every hour the run touched, not just the one it began in. The walk is
  // `runHourKeys` from the weather module rather than a local copy,
  // because `attach.ts` uses the same one to decide which hours to
  // *resolve* — a second copy of the rounding or the cap would let the
  // reader look for an hour the writer never fetched.
  const spans = batch.flatMap((run) =>
    run.lat === null || run.lng === null
      ? []
      : {
          runId: run.id,
          keys: runHourKeys(run.lat, run.lng, run.startedAt, run.durationS),
        },
  );
  // Keyed by cache cell rather than collected into a list: a run spans up
  // to six hours and a page holds two hundred runs, so a linear scan per
  // key is twelve hundred passes over the rows for an answer a lookup
  // gives directly. The cache holds real observations only: a band a
  // runner set lives in `manual_conditions`, read below (contracts.md).
  const byCell = new Map<string, ObservationRow>();
  const cells = await observationsAtCells(spans.flatMap(({ keys }) => keys));
  for (const row of cells) {
    byCell.set(cellKey(row.latR, row.lngR, row.hourBucket), row);
  }

  const result = new Map<string, Conditions>();
  const bands = await manualReadingsForRuns(batch.map((run) => run.id));
  for (const { runId, keys } of spans) {
    const band = bands.get(runId);
    if (band !== undefined) {
      // A band is one pick for the whole run: its span is that one point.
      result.set(runId, {
        tempC: band.tempC,
        feelsLikeC: band.feelsLikeC,
        precipMm: band.precipMm,
        condition: band.condition,
        windKph: band.windKph,
        source: band.source,
        span: pointSpan(band.tempC, band.feelsLikeC),
      });
      continue;
    }
    // Aligned with `keys`, so index 0 is the *starting* hour whether or
    // not it resolved. Taking "the first row found" instead would let a
    // run whose start never resolved answer with its second hour, under a
    // field that means "what they set out in".
    const hourRows = keys.map((key) =>
      byCell.get(cellKey(key.latR, key.lngR, key.hourBucket)),
    );
    const [start] = hourRows;
    // The starting hour is what `tempC`/`feelsLikeC` mean, so a run
    // missing it has no conditions at all — the behaviour before this
    // lane, kept. A run missing only its *later* hours still answers, over
    // the hours that did resolve.
    if (start === undefined) continue;
    const hours = hourRows.flatMap((row) => (row === undefined ? [] : [row]));
    result.set(runId, {
      tempC: start.tempC,
      feelsLikeC: start.feelsLikeC,
      precipMm: start.precipMm,
      condition: start.condition,
      windKph: start.windKph,
      source: start.source,
      // The starting hour's zone — a run does not change zone mid-run in
      // any way the date on its card cares about.
      ...zoneField(start.timeZone),
      span: {
        minTempC: Math.min(...hours.map((h) => h.tempC)),
        maxTempC: Math.max(...hours.map((h) => h.tempC)),
        minFeelsLikeC: Math.min(...hours.map((h) => h.feelsLikeC)),
        maxFeelsLikeC: Math.max(...hours.map((h) => h.feelsLikeC)),
      },
    });
  }
  return result;
}
