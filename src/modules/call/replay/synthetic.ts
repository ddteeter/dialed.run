/**
 * Seeded, synthetic runner histories to replay over until real logged
 * Calls exist. Every persona states its truth, so a test can show the
 * harness finds it. Nothing here is a real runner's data.
 */
import {
  CALL_VERDICT_THRESHOLD,
  THERMAL_LEVEL_C,
  uiGroupFor,
  uiGroups,
  type UiGroup,
  type VerdictValue,
} from "../../../lib/contracts";
import {
  bandFloorC,
  PRECIP_LEVELS,
  type PrecipClass,
} from "../../../lib/contracts/temperature";
import {
  estimateTempRange,
  type TempRange,
  type ThermalInput,
} from "../../../lib/contracts/thermal";
import type {
  ClosetPiece,
  CohortCell,
  PersonalRun,
  WornPiece,
} from "../contract";
import type { ReplayHistory } from "./case";

/**
 * mulberry32: a small 32-bit PRNG, so a seed always gives the same
 * personas. Never `Math.random()`.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

type Random = () => number;

/**
 * A number in [low, high), to a tenth.
 */
function tenthBetween(random: Random, low: number, high: number): number {
  return Math.round((low + random() * (high - low)) * 10) / 10;
}

/**
 * A whole number in [low, high].
 */
function intBetween(random: Random, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}

/**
 * D-108's floor and design 194's "Cohort data": a cell counts five or more
 * distinct runners. Pinned to the consensus module's constant by a test.
 */
export const COHORT_FLOOR = 5;

const PIECES: readonly { pieceId: string; input: ThermalInput }[] = [
  { pieceId: "tee", input: { category: "top", weight: "light" } },
  { pieceId: "long-sleeve", input: { category: "top", weight: "mid" } },
  { pieceId: "base-layer", input: { category: "top", weight: "heavy" } },
  { pieceId: "shorts", input: { category: "bottom", weight: "light" } },
  { pieceId: "tights", input: { category: "bottom", weight: "mid" } },
  { pieceId: "winter-tights", input: { category: "bottom", weight: "heavy" } },
  {
    pieceId: "shell",
    input: {
      category: "top",
      layer: "outer",
      weight: "light",
      windResistant: true,
    },
  },
  {
    pieceId: "jacket",
    input: { category: "top", layer: "outer", weight: "mid" },
  },
  { pieceId: "gloves", input: { category: "gloves", weight: "light" } },
  { pieceId: "shoes", input: { category: "shoes" } },
];

/**
 * Every persona's closet: groups from `uiGroupFor`, ranges from
 * `estimateTempRange`, so it moves when the thermal tables move.
 */
export function syntheticCloset(): ClosetPiece[] {
  return PIECES.map(({ pieceId, input }) => ({
    pieceId,
    group: uiGroupFor(input.category, input.layer),
    estimate: estimateTempRange(input),
  }));
}

function isWithin(range: TempRange | undefined, feelC: number): boolean {
  if (range === undefined) return true;
  const isAboveFloor = range.lowC === undefined || feelC >= range.lowC;
  return isAboveFloor && (range.highC === undefined || feelC <= range.highC);
}

function floorOf(piece: ClosetPiece): number {
  return piece.estimate?.lowC ?? -Infinity;
}

/**
 * How every persona dresses for a feel: in each group, the lightest piece
 * whose range holds it (the highest floor), and none where nothing does. A
 * piece with no estimate carries no thermal signal and is always worn.
 */
export function dressFor(
  closet: readonly ClosetPiece[],
  feelC: number,
): WornPiece[] {
  return uiGroups.flatMap((group) => {
    let lightest: ClosetPiece | undefined;
    for (const piece of closet) {
      const isCandidate =
        piece.group === group && isWithin(piece.estimate, feelC);
      if (
        isCandidate &&
        (lightest === undefined || floorOf(piece) > floorOf(lightest))
      ) {
        lightest = piece;
      }
    }
    return lightest === undefined
      ? []
      : { pieceId: lightest.pieceId, group: lightest.group };
  });
}

/**
 * The verdict for a kit chosen for `dressedForC` when the runner needed
 * `needC`: within 2° is dialed; dressed for a warmer feel than needed is
 * cold, past 5° way cold; the other way is warm.
 */
export function verdictFor(dressedForC: number, needC: number): VerdictValue {
  const gap = dressedForC - needC;
  if (gap > 5) return -2;
  if (gap > 2) return -1;
  if (gap < -5) return 2;
  return gap < -2 ? 1 : 0;
}

/**
 * Where a dressing choice is clamped, so the closet always holds a top and
 * a bottom for it.
 */
const DRESS_RANGE_C = { low: -6, high: 35 } as const;
const DRESS_NOISE_C = 6;

const HOME_ZONE = "Cfb";
const DAY_S = 86_400;
/**
 * 2026-01-05T00:00:00Z: the synthetic year starts on a Monday.
 */
const START_S = 1_767_571_200;

type Climate = readonly [low: number, high: number];

const TEMPERATE: Climate = [-4, 18];

interface PersonaSpec {
  name: string;
  truth: string;
  runs: number;
  /**
   * Added to the feel a runner needs to dress for: a runner who runs
   * cold needs a colder feel's kit.
   */
  needOffsetC: number;
  thermalLevel?: number;
  climate: Climate;
  trip?: { from: number; runs: number; climate: Climate };
  flag?: PieceFlag;
}

/**
 * A piece the runner flags `too_much` whenever they wear it above a feel.
 */
export interface PieceFlag {
  pieceId: string;
  aboveC: number;
}

export interface Persona {
  name: string;
  truth: string;
  needOffsetC: number;
  history: ReplayHistory;
  cohort: CohortCell[];
}

const SPECS: readonly PersonaSpec[] = [
  {
    name: "runs-cold",
    truth: "dialed in the kit for a feel 4.4° colder than the forecast",
    runs: 60,
    needOffsetC: -2 * THERMAL_LEVEL_C,
    thermalLevel: 2,
    climate: TEMPERATE,
  },
  {
    name: "runs-warm",
    truth: "dialed in the kit for a feel 4.4° warmer than the forecast",
    runs: 60,
    needOffsetC: 2 * THERMAL_LEVEL_C,
    thermalLevel: -2,
    climate: TEMPERATE,
  },
  {
    name: "sparse",
    truth: "fewer verdicts than the Call's threshold",
    runs: CALL_VERDICT_THRESHOLD - 1,
    needOffsetC: 0,
    climate: TEMPERATE,
  },
  {
    name: "one-band",
    truth: "every verdict in the 10° band (O6)",
    runs: 40,
    needOffsetC: 0,
    climate: [10, 14.9],
  },
  {
    name: "trip",
    truth: "six runs in a hot climate with no zone cells there (C1b, C2b)",
    runs: 50,
    needOffsetC: 0,
    climate: TEMPERATE,
    trip: { from: 30, runs: 6, climate: [26, 34] },
  },
  {
    name: "flagged",
    truth:
      "the long sleeve is flagged too much, and the run a bit warm, above 10°",
    runs: 40,
    needOffsetC: 0,
    climate: TEMPERATE,
    flag: { pieceId: "long-sleeve", aboveC: 10 },
  },
];

function isOnTrip(spec: PersonaSpec, index: number): boolean {
  return climateOf(spec, index) !== spec.climate;
}

function climateOf(spec: PersonaSpec, index: number): Climate {
  const trip = spec.trip;
  if (trip === undefined) return spec.climate;
  const isAway = index >= trip.from && index < trip.from + trip.runs;
  return isAway ? trip.climate : spec.climate;
}

/**
 * Half the runs dry, three in ten damp, two in ten wet.
 */
export function precipFor(draw: number): PrecipClass {
  if (draw < 0.5) return "dry";
  return draw < 0.8 ? "damp" : "wet";
}

export function flagWorn(
  flag: PieceFlag | undefined,
  worn: readonly WornPiece[],
  feelC: number,
): WornPiece[] {
  return worn.map((piece) =>
    piece.pieceId === flag?.pieceId && feelC > flag.aboveC
      ? { ...piece, flag: "too_much" }
      : piece,
  );
}

function runFor(
  spec: PersonaSpec,
  closet: readonly ClosetPiece[],
  random: Random,
  index: number,
): PersonalRun {
  const climate = climateOf(spec, index);
  const feelC = tenthBetween(random, climate[0], climate[1]);
  const needC = feelC + spec.needOffsetC;
  const chosen = tenthBetween(
    random,
    needC - DRESS_NOISE_C,
    needC + DRESS_NOISE_C,
  );
  const dressedForC = Math.min(
    DRESS_RANGE_C.high,
    Math.max(DRESS_RANGE_C.low, chosen),
  );
  const worn = flagWorn(spec.flag, dressFor(closet, dressedForC), feelC);
  const verdict = verdictFor(dressedForC, needC);
  const isFlagged = worn.some((piece) => piece.flag !== undefined);
  return {
    runId: `${spec.name}-${String(index).padStart(3, "0")}`,
    startedAt: START_S + index * DAY_S + intBetween(random, 6, 19) * 3600,
    judgedFeelsLikeC: feelC,
    precip: precipFor(random()),
    source: "visualcrossing",
    verdict: isFlagged ? 1 : verdict,
    worn,
  };
}

function verdictCounts(
  random: Random,
  groupRunners: number,
): Record<VerdictValue, number> {
  return {
    [-2]: intBetween(random, 0, 3),
    [-1]: intBetween(random, 0, 6),
    0: groupRunners + intBetween(random, 0, 10),
    1: intBetween(random, 0, 6),
    2: intBetween(random, 0, 3),
  };
}

type Where = Pick<CohortCell, "rung" | "climateZone" | "thermalLevel">;

function cellFor(
  random: Random,
  where: Where,
  bandFloor: number,
  precip: CohortCell["precip"],
  group: UiGroup,
): CohortCell {
  const bandRunners = intBetween(random, COHORT_FLOOR, COHORT_FLOOR + 40);
  const groupRunners = intBetween(random, COHORT_FLOOR, bandRunners);
  return {
    ...where,
    bandFloorC: bandFloor,
    precip,
    group,
    bandRunners,
    groupRunners,
    verdicts: verdictCounts(random, groupRunners),
  };
}

/**
 * The ladder's rungs for a band: everyone always, the zone rungs only for
 * bands the runner's home climate reaches.
 */
function rungsFor(spec: PersonaSpec, isHome: boolean): Where[] {
  const everyone: Where = { rung: "everyone" };
  if (!isHome) return [everyone];
  const zone: Where = { rung: "zone", climateZone: HOME_ZONE };
  if (spec.thermalLevel === undefined) return [zone, everyone];
  const narrowest: Where = {
    rung: "zone-and-thermal",
    climateZone: HOME_ZONE,
    thermalLevel: spec.thermalLevel,
  };
  return [narrowest, zone, everyone];
}

function cohortFor(
  spec: PersonaSpec,
  runs: readonly PersonalRun[],
  random: Random,
): CohortCell[] {
  const homeBands = new Set(
    runs
      .filter((_, i) => !isOnTrip(spec, i))
      .map((r) => bandFloorC(r.judgedFeelsLikeC)),
  );
  const bands = [
    ...new Set(runs.map((r) => bandFloorC(r.judgedFeelsLikeC))),
  ].toSorted((a, b) => a - b);
  return bands.flatMap((band) =>
    rungsFor(spec, homeBands.has(band)).flatMap((where) =>
      PRECIP_LEVELS.flatMap((precip) =>
        uiGroups.map((group) => cellFor(random, where, band, precip, group)),
      ),
    ),
  );
}

function personaFor(spec: PersonaSpec, random: Random): Persona {
  const closet = syntheticCloset();
  const runs = Array.from({ length: spec.runs }, (_, index) =>
    runFor(spec, closet, random, index),
  );
  return {
    name: spec.name,
    truth: spec.truth,
    needOffsetC: spec.needOffsetC,
    history: {
      runnerId: `synthetic-${spec.name}`,
      runner: { thermalLevel: spec.thermalLevel, climateZone: HOME_ZONE },
      closet,
      runs,
    },
    cohort: cohortFor(spec, runs, random),
  };
}

/**
 * The six personas for one seed. The same seed gives the same personas.
 */
export function syntheticPersonas(seed: number): Persona[] {
  const random = seededRandom(seed);
  return SPECS.map((spec) => personaFor(spec, random));
}
