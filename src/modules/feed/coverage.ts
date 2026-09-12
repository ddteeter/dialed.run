import type { VerdictKind } from "../../ui";

import { bandFloorC } from "../../lib/temperature";
import type { Conditions } from "./conditions-shape";
import { judgedFeelsLikeC } from "./judged-conditions";

/**
 * How many verdicts of each kind a runner has in one 5°C band.
 *
 * Pure, and in its own file, for two reasons: the profile screen and the
 * Call tab both need this counted the same way — two implementations of
 * it is the rival-truth failure D-10 already cost us once — and nothing
 * here touches `env`, so a component or a jsdom test can import it.
 */
export interface CoverageBand {
  bandFloorC: number;
  label: string;
  cold: number;
  dialed: number;
  warm: number;
}

export const BAND_STEP_C = 5;

export interface CoverageTally {
  bands: ReadonlyMap<number, CoverageBand>;
  /**
  The coldest and warmest band the runner has actually logged in.
  */
  range: { min: number; max: number } | undefined;
}

/**
 * Count verdicts into bands.
 *
 * An entry lands in the band of the hour its verdict was *about*, not the
 * one its run began in — see `judgedFeelsLikeC`. Entries with no verdict,
 * or whose conditions never resolved, are not counted: the ladder measures
 * what the app has been told, and an unrated run has told it nothing.
 */
export function tallyCoverage(
  entries: readonly { runId: string; verdict: number | null }[],
  observations: ReadonlyMap<string, Conditions>,
  labelFor: (bandFloor: number) => string,
): CoverageTally {
  const bands = new Map<number, CoverageBand>();
  let range: { min: number; max: number } | undefined;

  for (const entry of entries) {
    const { verdict } = entry;
    if (verdict === null) continue;
    const observation = observations.get(entry.runId);
    if (!observation) continue;

    const floor = bandFloorC(judgedFeelsLikeC(observation, verdict));
    const band = bands.get(floor) ?? {
      bandFloorC: floor,
      label: labelFor(floor),
      cold: 0,
      dialed: 0,
      warm: 0,
    };
    if (verdict < 0) band.cold += 1;
    else if (verdict > 0) band.warm += 1;
    else band.dialed += 1;
    bands.set(floor, band);
    range = range
      ? { min: Math.min(range.min, floor), max: Math.max(range.max, floor) }
      : { min: floor, max: floor };
  }

  return { bands, range };
}

/**
 * The bands the runner has logged in, coldest first — gaps omitted.
 *
 * What the profile screen shows: a list of what someone has done.
 */
export function bandsAscending(tally: CoverageTally): CoverageBand[] {
  return spanFloors(tally).flatMap((floor) => {
    const band = tally.bands.get(floor);
    return band === undefined ? [] : [band];
  });
}

/**
 * The same span with its gaps present as empty bands.
 *
 * What the ladder shows, and the difference is the whole point of O6: "a
 * runner with 40 verdicts all at 50° is still guessing in January", so the
 * screen has to render the bands they have *not* covered in order to ask
 * for them. Omitting a gap would make the ladder look complete.
 */
export function bandsAscendingWithGaps(
  tally: CoverageTally,
  labelFor: (bandFloor: number) => string,
): CoverageBand[] {
  return spanFloors(tally).map(
    (floor) =>
      tally.bands.get(floor) ?? {
        bandFloorC: floor,
        label: labelFor(floor),
        cold: 0,
        dialed: 0,
        warm: 0,
      },
  );
}

/**
 * Every band floor between the coldest and warmest the runner has logged.
 *
 * Bounded by their own history rather than by a fixed scale, because the
 * bands a runner never runs in are not gaps in their data — they are
 * weather they do not have.
 */
function spanFloors(tally: CoverageTally): number[] {
  const { range } = tally;
  if (range === undefined) return [];
  const floors: number[] = [];
  for (let floor = range.min; floor <= range.max; floor += BAND_STEP_C) {
    floors.push(floor);
  }
  return floors;
}

/**
 * How a runner called a band, in one word.
 *
 * Design §AB3 gives each band a single characterisation — "Under-dressed",
 * "Dialed", "Over-dressed" — beside its run count, rather than three
 * competing dot runs. This is the derivation that produces it.
 *
 * **Ties go to the colder end**, the same rule and the same reason
 * `ladderFrom` picks its thinnest band that way: underdressing is the
 * failure that ends a run early, so a band a runner gets wrong in both
 * directions equally is worth naming as the direction that costs more.
 */
export function bandVerdict(band: CoverageBand): VerdictKind {
  if (band.cold >= band.dialed && band.cold >= band.warm) return "cold";
  return band.dialed >= band.warm ? "dialed" : "warm";
}

