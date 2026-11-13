/**
 * The styling audit's dense seed, as rows (design 205, "Seeded data").
 *
 * Pure and deterministic: a fixed PRNG and an injected `now`, so the same
 * `now` builds the same rows byte for byte, and a `now` a whole number of
 * days later moves every timestamp and nothing else. `seed-db.ts` writes
 * what this builds; nothing here touches a database, R2 or a browser.
 *
 * Every fictional runner, garment and sentence is in `./data/*.json`,
 * parsed once below. What is left in this file is how they combine: which
 * kit a temperature calls for, which runs are indoor, who found what
 * useful. What it builds, for one runner (Maya) and the people around her:
 *
 * - 40 garments in Maya's Closet, 16 in each other runner's;
 * - 63 runs for Maya: 48 with a kit, 15 in the backlog;
 * - 20 other runners with 65 entries between them, follows and Useful;
 * - every notification kind, the Desk's queues, invite codes, access
 *   requests and jobs that gave up;
 * - the R2 objects the photo rows name, as synthetic artwork to draw.
 */
import { ulid } from "ulidx";

import { reviewQueue, runs } from "../../src/db/schema-core";
import type {
  manualConditions,
  weatherObservations,
} from "../../src/db/schema-weather";
import {
  SHARED_AUDIENCE,
  WORLD_AUDIENCE,
  garmentSchema,
  isStrangerAudience,
  pointSpan,
  weatherHalfOf,
  type Audience,
  type Garment,
} from "../../src/lib/contracts";
import { entryPhotoKeyFor } from "../../src/lib/entry-photo-key";
import {
  garmentOriginalKey,
  photoKeyFor,
} from "../../src/lib/garment-photo-key";
import { fitWithin } from "../../src/lib/photo-pipeline";
import {
  MAYA,
  MAYA_ID,
  access,
  auditSeedSchema,
  desk,
  garmentsData,
  inbox,
  kits,
  people,
  photoPlan,
  productFacts,
  runsData,
  summaryPlan,
  type Artwork,
  type AuditSeed,
  type ClosetGarment,
  type KitTable,
  type LongTitles,
  type Modes,
  type Ref,
  type Runner,
  type Slot,
} from "./dense-data";
import type { RowsOf, coreTables } from "./tables";

export {
  MAYA,
  MAYA_HANDLE,
  MAYA_ID,
  PHOTO_SIZES,
  auditSeedSchema,
  type Artwork,
  type AuditSeed,
  type ClosetGarment,
  type KitTable,
  type Ref,
  type Slot,
} from "./dense-data";

export const HOUR = 3600;
export const DAY = 86_400;

// ------------------------------------------------------------------- output

/**
One object for R2: which artwork to draw, at what size, as what.
*/
export interface R2Object {
  key: string;
  contentType: "image/jpeg" | "image/webp";
  art: Artwork;
  width: number;
  height: number;
}

export type CoreRows = RowsOf<typeof coreTables>;

export interface WeatherRows {
  observations: (typeof weatherObservations.$inferInsert)[];
  manual: (typeof manualConditions.$inferInsert)[];
}

export interface DenseSeed {
  core: CoreRows;
  weather: WeatherRows;
  objects: R2Object[];
  summary: AuditSeed;
  /**
  Review-queue rows carry minted ids, so cleaning up needs the list.
  */
  queueIds: string[];
}

// ------------------------------------------------------------------ helpers

/**
 * mulberry32: a small, fast PRNG with a fixed seed, so two builds draw
 * the same numbers in the same order.
 */
export function prng(seed: number): () => number {
  let state = seed;
  return () => {
    state = Math.imul(state + 0x6d_2b_79_f5, 1);
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
The item at `index`; a missing one is a data bug, so it fails loudly.
*/
export function nth<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`no item at ${String(index)}`);
  return item;
}

/**
Cycle through a list: `index` past the end wraps round.
*/
export function pick<T>(list: readonly T[], index: number): T {
  return nth(list, index % list.length);
}

export function fToC(fahrenheit: number): number {
  return ((fahrenheit - 32) * 5) / 9;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const ago = (now: number, hours: number) => now - Math.round(hours * HOUR);

interface Weather {
  feelsC: number;
  precipMm: number;
  condition: string;
}

type Mode = "normal" | "indoor" | "manual" | "failed" | "pending";

/**
What `runs.weather_status` says of a run in `mode`.
*/
export function weatherStatusOf(
  mode: Mode,
): (typeof runs.weatherStatus.enumValues)[number] {
  if (mode === "normal") return "attached";
  return mode === "indoor" ? "none" : mode;
}

/**
Which mode a run at `index` is in, from a table of exceptions.
*/
export function modeOf(table: Modes, index: number): Mode {
  for (const mode of ["indoor", "manual", "failed", "pending"] as const) {
    if (table[mode]?.includes(index) === true) return mode;
  }
  return "normal";
}

/**
A title from the list, unless the table names a long one for `run`.
*/
function titleOf(table: LongTitles, run: number, fallback: string): string {
  const long = table.find((row) => row.run === run);
  return long === undefined ? fallback : nth(runsData.longTitles, long.title);
}

/**
The weather a run `daysAgo` had: the season's feel, jittered.
*/
export function weatherFor(
  rnd: () => number,
  daysAgo: number,
  index: number,
): Weather {
  const season = runsData.seasons.bands.find(
    (band) => daysAgo < band.withinDays,
  );
  const feelsC =
    (season?.feelsC ?? runsData.seasons.beyondC) +
    Math.round((rnd() - 0.5) * 10);
  if (index % 5 === 3) return { feelsC, ...runsData.wet };
  if (index % 7 === 2) return { feelsC, ...runsData.damp };
  return { feelsC, precipMm: 0, condition: pick(runsData.skies, index) };
}

function pickSlot(slot: Slot, index: number, isWet: boolean): string | null {
  if (Array.isArray(slot)) return pick(slot, index);
  return pick(isWet ? slot.wet : slot.dry, index);
}

/**
The value under `key`; a missing key is a data bug, so it fails loudly.
*/
export function lookup<V>(map: ReadonlyMap<string, V>, key: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`nothing under "${key}"`);
  return value;
}

/**
The kit a runner wears at `feelsC`: one garment per slot, or none.
*/
export function kitFor(
  table: KitTable,
  closet: Map<string, string>,
  feelsC: number,
  index: number,
  isWet: boolean,
): string[] {
  const band = table.bands.find((row) => feelsC < row.belowC);
  const slots = [...(band?.slots ?? table.warm), table.shoes];
  return slots
    .map((slot) => pickSlot(slot, index, isWet))
    .filter((key) => key !== null)
    .map((key) => lookup(closet, key));
}

/**
The tags a verdict's runner would pick: none on odd runs.
*/
export function tagsFor(verdict: number | undefined, index: number): string[] {
  if (verdict === undefined || index % 2 === 1) return [];
  const { under, over, dialed } = runsData.tags;
  const count = 1 + (index % 3);
  if (verdict < 0) return under.slice(0, count);
  return (verdict > 0 ? over : dialed).slice(0, count);
}

/**
The flag on a kit's first garment: which way the verdict went.
*/
export function flagFor(
  verdict: number | undefined,
  position: number,
): "too_much" | "not_enough" | undefined {
  if (position !== 0) return undefined;
  const sign = Math.sign(verdict ?? 0);
  if (sign === 0) return undefined;
  return sign === 1 ? "too_much" : "not_enough";
}

export function skyOf(precipMm: number): "rain" | "damp" | "dry" {
  if (precipMm > 2) return "rain";
  return precipMm > 0 ? "damp" : "dry";
}

// -------------------------------------------------------------------- world

interface Place {
  lat: number;
  lng: number;
}

interface World {
  now: number;
  rnd: () => number;
  core: CoreRows;
  weather: WeatherRows;
  objects: R2Object[];
  products: Map<string, string>;
  // The same ids in the order they were made, for `productAt` refs.
  productOrder: string[];
  brands: Map<string, string>;
  closets: Map<string, Map<string, string>>;
  entries: Map<string, string[]>;
  mayaRuns: { runId: string; entryId: string }[];
  backlog: string[];
  entryPhotoCount: number;
  queueIds: string[];
}

function emptyCore(): CoreRows {
  return {
    user: [],
    userProfiles: [],
    brands: [],
    products: [],
    wardrobeItems: [],
    runs: [],
    outfitEntries: [],
    outfitEntryItems: [],
    entryTags: [],
    entryPhotos: [],
    runConditions: [],
    follows: [],
    reactions: [],
    notifications: [],
    reviewQueue: [],
    reports: [],
    moderationActions: [],
    accountDeletions: [],
    productCorrections: [],
    inviteCodes: [],
    inviteRedemptions: [],
    accessRequests: [],
    gaveUp: [],
  };
}

/**
A ULID minted at `at` (seconds) from the world's PRNG.
*/
function mint(world: World, at: number): string {
  return ulid(at * 1000, world.rnd);
}

function resolve(world: World, ref: Ref): string {
  switch (ref.ref) {
    case "id": {
      return ref.id;
    }
    case "fresh": {
      return mint(world, world.now);
    }
    case "maya": {
      return lookup(lookup(world.closets, MAYA_ID), ref.garment);
    }
    case "garment": {
      return lookup(lookup(world.closets, ref.runner), ref.garment);
    }
    case "entry": {
      return nth(lookup(world.entries, ref.runner), ref.index);
    }
    case "backlog": {
      return nth(world.backlog, ref.index);
    }
    case "productAt": {
      return nth(world.productOrder, ref.index);
    }
  }
}

// ----------------------------------------------------------------- garments

function productFor(world: World, garment: Garment): string {
  // Every garment the data marks a product has a brand.
  const brand = String(garment.brand);
  const key = `${brand}|${garment.name}`;
  const existing = world.products.get(key);
  if (existing !== undefined) return existing;
  const at = world.now - 150 * DAY;
  const brandId = brandFor(world, brand, at);
  const id = mint(world, at);
  world.products.set(key, id);
  world.productOrder.push(id);
  const facts = productFacts.parse(garment);
  world.core.products.push({
    id,
    brandId,
    name: garment.name,
    normalizedName: garment.name.toLowerCase(),
    type: facts.type,
    categoryHint: garment.category,
    weight: facts.weight,
    fabric: facts.fabric,
    fabricComposition:
      facts.fabric === "merino"
        ? desk.compositions.merino
        : desk.compositions.other,
    windResistant: facts.windResistant,
    waterResistant: facts.waterResistant,
    sourceUrl: `https://example.com/products/${id.toLowerCase()}`,
    extractionStatus: "done",
    createdBy: MAYA_ID,
    createdAt: at,
  });
  return id;
}

function brandFor(world: World, name: string, at: number): string {
  const existing = world.brands.get(name);
  if (existing !== undefined) return existing;
  const id = mint(world, at);
  world.brands.set(name, id);
  world.core.brands.push({
    id,
    name,
    normalized: `${name.toLowerCase()} audit`,
  });
  return id;
}

/**
The garment as the closet form would have saved it: through the schema.
*/
export function garmentOf(entry: ClosetGarment): Garment {
  return garmentSchema.parse({
    ...entry.garment,
    ...(entry.tempF && {
      estTempLowC: fToC(entry.tempF.low),
      estTempHighC: fToC(entry.tempF.high),
    }),
  });
}

function garmentPhoto(
  world: World,
  userId: string,
  itemId: string,
  photo: number,
  at: number,
): string {
  const version = `${photoKeyFor(userId, itemId)}/${mint(world, at)}`;
  const art = {
    ...nth(photoPlan.garments, photo - 1),
    kind: "garment" as const,
  };
  world.objects.push({
    key: garmentOriginalKey(version),
    contentType: "image/jpeg",
    art,
    width: art.width,
    height: art.height,
  });
  for (const [size, max] of Object.entries(photoPlan.sizes)) {
    world.objects.push({
      key: `${version}/${size}.webp`,
      contentType: "image/webp",
      art,
      ...fitWithin(art.width, art.height, max),
    });
  }
  return version;
}

function stock(
  world: World,
  userId: string,
  list: readonly ClosetGarment[],
  createdAt: number,
  photoEvery: number,
): Map<string, string> {
  const closet = new Map<string, string>();
  world.closets.set(userId, closet);
  for (const [index, entry] of list.entries()) {
    const at = createdAt + index * 600;
    const id = mint(world, at);
    closet.set(entry.key, id);
    const garment = garmentOf(entry);
    const photoKey =
      entry.photo !== undefined && index % photoEvery === 0
        ? garmentPhoto(world, userId, id, entry.photo, at)
        : undefined;
    world.core.wardrobeItems.push({
      ...garment,
      id,
      userId,
      productId: entry.product ? productFor(world, garment) : undefined,
      photoKey,
      visibility: photoKey === undefined ? "ok" : "pass",
      origin: "manual",
      retired: entry.retired === true,
      retiredAt: entry.retired ? at + 60 * DAY : undefined,
      createdAt: at,
    });
  }
  return closet;
}

// --------------------------------------------------------------------- runs

/**
Hourly readings over a run, one per place and hour however many runs.
*/
function observe(
  world: World,
  at: Place,
  startedAt: number,
  durationS: number,
  weather: Weather,
): void {
  const first = Math.floor(startedAt / HOUR);
  const hours = Math.min(
    6,
    Math.floor((startedAt + durationS) / HOUR) - first + 1,
  );
  for (let hour = 0; hour < hours; hour += 1) {
    const hourBucket = first + hour;
    world.weather.observations.push({
      id: `audit-${mint(world, world.now)}`,
      latR: at.lat,
      lngR: at.lng,
      hourBucket,
      tempC: weather.feelsC + 2 + hour,
      feelsLikeC: weather.feelsC + hour,
      humidity: 62,
      windKph: 9 + hour * 2,
      precipMm: weather.precipMm,
      condition: weather.condition,
      timeZone: undefined,
      source: "visualcrossing",
      fetchedAt: world.now,
    });
  }
}

interface EntryPlan {
  verdict: number | undefined;
  audience: Audience;
  photos: number;
}

interface RunPlan {
  userId: string;
  at: Place;
  startedAt: number;
  title: string;
  index: number;
  weather: Weather;
  kits: KitTable;
  mode: Mode;
  source: (typeof runs.source.enumValues)[number];
  entry?: EntryPlan;
}

function runRow(
  world: World,
  plan: RunPlan,
): { id: string; durationS: number } {
  const id = mint(world, plan.startedAt);
  const { index } = plan;
  const distanceM = pick(runsData.distancesM, index);
  const durationS = Math.round((distanceM / 1000) * (300 + (index % 5) * 14));
  const isIndoor = plan.mode === "indoor";
  const isWatch = index % 3 === 0;
  world.core.runs.push({
    id,
    userId: plan.userId,
    source: plan.source,
    startedAt: plan.startedAt,
    durationS,
    distanceM,
    movingS: durationS - 40,
    elevationGainM: (index * 37) % 240,
    lat: isIndoor ? undefined : plan.at.lat,
    lng: isIndoor ? undefined : plan.at.lng,
    indoor: isIndoor,
    effort: pick(runsData.efforts, index),
    rpe: isWatch ? 3 + (index % 6) : undefined,
    effortSource: isWatch ? "watch" : undefined,
    deviceName: pick(runsData.devices, index),
    title: plan.title,
    weatherStatus: weatherStatusOf(plan.mode),
  });
  return { id, durationS };
}

type ConditionsHalf = ReturnType<typeof weatherHalfOf>;

function conditionsOf(
  world: World,
  plan: RunPlan,
  runId: string,
  durationS: number,
): ConditionsHalf | undefined {
  const { feelsC, precipMm } = plan.weather;
  if (plan.mode === "normal") {
    observe(world, plan.at, plan.startedAt, durationS, plan.weather);
    return halfOf(feelsC, precipMm, "visualcrossing");
  }
  if (plan.mode !== "manual") return undefined;
  world.weather.manual.push({
    runId,
    tempC: feelsC,
    setAt: plan.startedAt + HOUR,
    sky: skyOf(precipMm),
  });
  return halfOf(feelsC, precipMm, "manual");
}

/**
 * The weather half of a run's conditions row. Only the feel, the rain and
 * the source reach it (`weatherHalfOf`), so the rest is filled from them.
 */
function halfOf(
  feelsC: number,
  precipMm: number,
  source: "visualcrossing" | "manual",
): ConditionsHalf {
  return weatherHalfOf({
    tempC: feelsC,
    feelsLikeC: feelsC,
    precipMm,
    condition: source,
    windKph: 0,
    source,
    span: pointSpan(feelsC, feelsC),
  });
}

function entryPhoto(
  world: World,
  userId: string,
  entryId: string,
  position: number,
  screenStatus: "pass" | "hidden_pending_review",
): string {
  const id = mint(world, world.now);
  const key = entryPhotoKeyFor(userId, entryId, id);
  world.entryPhotoCount += 1;
  const art = {
    ...pick(photoPlan.entries, world.entryPhotoCount),
    kind: "entry" as const,
  };
  world.objects.push({
    key,
    contentType: "image/jpeg",
    art,
    width: art.width,
    height: art.height,
  });
  world.core.entryPhotos.push({
    id,
    entryId,
    photoKey: key,
    position,
    screenStatus,
  });
  return id;
}

function entryRows(
  world: World,
  plan: RunPlan,
  entry: EntryPlan,
  runId: string,
  createdAt: number,
): string {
  const id = mint(world, createdAt);
  world.core.outfitEntries.push({
    id,
    runId,
    userId: plan.userId,
    verdict: entry.verdict,
    audience: entry.audience,
    createdAt,
  });
  const feelsC =
    plan.mode === "indoor" ? kits.indoorFeelsC : plan.weather.feelsC;
  const kit = kitFor(
    plan.kits,
    lookup(world.closets, plan.userId),
    feelsC,
    plan.index,
    skyOf(plan.weather.precipMm) === "rain",
  );
  for (const [position, itemId] of kit.entries()) {
    world.core.outfitEntryItems.push({
      entryId: id,
      itemId,
      flag: flagFor(entry.verdict, position),
    });
  }
  for (const tag of tagsFor(entry.verdict, plan.index)) {
    world.core.entryTags.push({ entryId: id, tag });
  }
  for (let position = 0; position < entry.photos; position += 1) {
    entryPhoto(world, plan.userId, id, position, "pass");
  }
  return id;
}

/**
A run with no kit yet (the backlog), and its conditions.
*/
function logBareRun(world: World, plan: RunPlan): string {
  const { id: runId, durationS } = runRow(world, plan);
  const conditions = conditionsOf(world, plan, runId, durationS);
  if (conditions !== undefined) {
    world.core.runConditions.push({
      runId,
      userId: plan.userId,
      ...conditions,
      entryShared: false,
    });
  }
  return runId;
}

type EntryRunPlan = RunPlan & { entry: EntryPlan };

/**
One run, its conditions, and the entry on it.
*/
function logRun(
  world: World,
  plan: EntryRunPlan,
): { runId: string; entryId: string } {
  const { id: runId, durationS } = runRow(world, plan);
  const conditions = conditionsOf(world, plan, runId, durationS);
  const createdAt = plan.startedAt + durationS + 600;
  const { entry } = plan;
  const entryId = entryRows(world, plan, entry, runId, createdAt);
  if (conditions !== undefined) {
    world.core.runConditions.push({
      runId,
      userId: plan.userId,
      ...conditions,
      verdict: entry.verdict,
      entryCreatedAt: createdAt,
      entryShared: isStrangerAudience(entry.audience),
    });
  }
  return { runId, entryId };
}

export function mayaAudience(index: number): Audience {
  if (index % 6 === 5) return "private";
  return index % 4 === 1 ? WORLD_AUDIENCE : SHARED_AUDIENCE;
}

function mayaRuns(world: World): void {
  const plan = runsData.maya;
  for (let index = 0; index < plan.runs; index += 1) {
    world.mayaRuns.push(logRun(world, mayaRunPlan(world, index)));
  }
}

function mayaRunPlan(world: World, index: number): EntryRunPlan {
  const plan = runsData.maya;
  const daysAgo = 1 + index * 3.1;
  const title = pick(runsData.titles, index);
  return {
    userId: MAYA_ID,
    at: MAYA,
    startedAt: Math.floor(
      world.now - daysAgo * DAY - ((index * 5) % 11) * HOUR,
    ),
    title: titleOf(plan.longTitles, index, title),
    index,
    weather: weatherFor(world.rnd, daysAgo, index),
    kits: kits.maya,
    mode: modeOf(plan.modes, index),
    source: pick(runsData.mayaSources, index),
    entry: {
      verdict: plan.unjudged.includes(index)
        ? undefined
        : pick(runsData.verdictCycle, index),
      audience: mayaAudience(index),
      photos: index % 3 === 1 ? 1 + (index % 4) : 0,
    },
  };
}

function backlogRuns(world: World): void {
  const plan = runsData.backlog;
  for (let index = 0; index < plan.runs; index += 1) {
    const daysAgo = 0.3 + index * 2.4;
    const runId = logBareRun(world, {
      userId: MAYA_ID,
      at: MAYA,
      startedAt: Math.floor(world.now - daysAgo * DAY - (index % 5) * HOUR),
      title: titleOf(plan.longTitles, index, pick(runsData.titles, index + 5)),
      index: index + 100,
      weather: weatherFor(world.rnd, daysAgo, index + 3),
      kits: kits.maya,
      mode: modeOf(plan.modes, index),
      source: pick(runsData.mayaSources, index + 100),
    });
    world.backlog.push(runId);
  }
}

// ------------------------------------------------------------------- people

const joined = (now: number, daysAgo: number) =>
  new Date((now - daysAgo * DAY) * 1000);

function addUser(
  world: World,
  who: { id: string; handle: string },
  daysAgo: number,
  isVerified: boolean,
): void {
  const at = joined(world.now, daysAgo);
  world.core.user.push({
    id: who.id,
    name: who.handle,
    email: `${who.handle}@example.com`,
    emailVerified: isVerified,
    createdAt: at,
    updatedAt: at,
  });
}

function runnerEntry(
  world: World,
  runner: Runner,
  r: number,
  index: number,
): string {
  const isRecent = index === 0;
  // The first lands in the last two days at Maya's own conditions, so
  // Your conditions has a matched state.
  const daysAgo = isRecent ? 0.2 + (r % 8) * 0.22 : 2.5 + index * 4.3 + r * 0.4;
  const { rightNow } = runsData;
  const weather = isRecent
    ? { ...rightNow, feelsC: rightNow.feelsC + (r % 2) * 0.5 }
    : weatherFor(world.rnd, daysAgo + (r % 4) * 30, index + r);
  const spin = index + r;
  return logRun(world, {
    userId: runner.id,
    at: runner,
    startedAt: Math.floor(world.now - daysAgo * DAY),
    title: runner.long
      ? pick(runsData.longTitles, index)
      : pick(runsData.titles, spin),
    index: index + r * 3,
    weather,
    kits: kits.pool,
    mode: "normal",
    source: pick(runsData.otherSources, spin),
    entry: {
      verdict: isRecent
        ? pick(runsData.recentVerdicts, r)
        : pick(runsData.verdictCycle, spin),
      audience: index % 5 === 4 ? WORLD_AUDIENCE : SHARED_AUDIENCE,
      photos: runnerPhotos(spin),
    },
  }).entryId;
}

/**
How many photos another runner's entry has: none on every fourth.
*/
export function runnerPhotos(spin: number): number {
  if (spin % 4 === 3) return 0;
  return spin % 3 === 0 ? 2 : 1;
}

function otherRunner(world: World, runner: Runner, r: number): void {
  const { now } = world;
  addUser(world, runner, 20 + r * 9, true);
  const isMetric = r % 3 === 0;
  world.core.userProfiles.push({
    userId: runner.id,
    username: runner.handle,
    cityLabel: runner.city,
    lat: runner.lat,
    lng: runner.lng,
    tempUnit: isMetric ? "c" : "f",
    distanceUnit: isMetric ? "km" : "mi",
    onboardingComplete: true,
    publicProfile: r % 2 === 0,
    usernameScreen: "clear",
  });
  stock(
    world,
    runner.id,
    runner.long ? garmentsData.longPool : garmentsData.pool,
    now - 120 * DAY,
    r % 3 === 2 ? 2 : 1,
  );
  const entries: string[] = [];
  world.entries.set(runner.id, entries);
  for (let index = 0; index < runner.entries; index += 1) {
    entries.push(runnerEntry(world, runner, r, index));
  }
  if (runner.followed) {
    world.core.follows.push({
      followerId: MAYA_ID,
      followeeId: runner.id,
      createdAt: now - (30 + r) * DAY,
    });
  }
  if (runner.followsMaya) {
    world.core.follows.push({
      followerId: runner.id,
      followeeId: MAYA_ID,
      createdAt: now - (3 + r * 2) * DAY,
    });
  }
}

/**
The other runners follow each other, so a profile has counts.
*/
function crossFollows(world: World): void {
  const { runners } = people;
  for (const [r, runner] of runners.entries()) {
    for (let step = 1; step <= 3 + (r % 5); step += 1) {
      world.core.follows.push({
        followerId: runner.id,
        followeeId: pick(runners, r + step * 3).id,
        createdAt: world.now - step * DAY,
      });
    }
  }
}

function useful(world: World, entryId: string, userId: string, at: number) {
  world.core.reactions.push({ entryId, userId, kind: "useful", createdAt: at });
}

/**
"Useful" on entries: on the other runners' and on Maya's.
*/
function usefulRows(world: World): void {
  const { now } = world;
  const { runners } = people;
  for (const [r, runner] of runners.entries()) {
    for (const [index, entryId] of lookup(world.entries, runner.id).entries()) {
      const fans = (index * 7 + r * 3) % 12;
      for (let fan = 0; fan < fans; fan += 1) {
        useful(world, entryId, pick(runners, r + fan + 1).id, now - fan * HOUR);
      }
      if ((index + r) % 3 === 0) useful(world, entryId, MAYA_ID, now - HOUR);
    }
  }
  for (const [index, run] of world.mayaRuns.entries()) {
    if (mayaAudience(index) === "private") continue;
    const fans = (index * 5) % 9;
    for (let fan = 0; fan < fans; fan += 1) {
      useful(
        world,
        run.entryId,
        pick(runners, index + fan).id,
        now - fan * HOUR,
      );
    }
  }
}

// -------------------------------------------------------------------- inbox

function notificationRows(world: World): void {
  const followers = people.runners.filter((runner) => runner.followsMaya);
  for (const row of inbox.notifications) {
    const follower =
      row.follower === undefined ? undefined : nth(followers, row.follower);
    const createdAt = ago(world.now, row.hoursAgo);
    world.core.notifications.push({
      id: mint(world, createdAt),
      userId: MAYA_ID,
      kind: row.kind,
      subjectId: resolve(world, row.subject ?? { ref: "fresh" }),
      linkId:
        follower?.id ??
        (row.link === undefined ? undefined : resolve(world, row.link)),
      body:
        follower === undefined ? row.body : `@${follower.handle}${row.body}`,
      read: row.read,
      createdAt,
    });
  }
}

// --------------------------------------------------------------------- desk

function queue(
  world: World,
  row: {
    subjectType: (typeof reviewQueue.subjectType.enumValues)[number];
    subjectId: string;
    source: (typeof reviewQueue.source.enumValues)[number];
    hoursAgo: number;
    status?: (typeof reviewQueue.status.enumValues)[number] | undefined;
  },
): void {
  const at = ago(world.now, row.hoursAgo);
  const id = mint(world, at);
  world.queueIds.push(id);
  const status = row.status ?? "pending";
  const isResolved = status !== "pending";
  world.core.reviewQueue.push({
    id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    source: row.source,
    status,
    createdAt: at,
    openedAt: at,
    resolvedBy: isResolved ? desk.operator : undefined,
    resolvedAt: isResolved ? world.now - HOUR : undefined,
  });
}

function deskRows(world: World): void {
  const { now } = world;
  for (const row of desk.queue) {
    queue(world, { ...row, subjectId: resolve(world, row.subject) });
  }
  for (const [index, row] of desk.reports.entries()) {
    world.core.reports.push({
      id: `audit-rep${pad2(index + 1)}`,
      reporterId: row.reporter,
      subjectType: row.subjectType,
      subjectId: resolve(world, row.subject),
      reason: row.reason,
      note: row.note,
      createdAt: ago(now, row.hoursAgo),
    });
  }
  // Photos held by the screener: extra photo rows on real entries.
  for (const row of desk.heldPhotos) {
    const entryId = resolve(world, row.entry);
    const photoId = entryPhoto(
      world,
      row.entry.runner,
      entryId,
      3,
      "hidden_pending_review",
    );
    queue(world, { ...row, subjectType: "photo", subjectId: photoId });
  }
  // Flagged: an intimate-image removal with no account decision after it.
  for (const row of desk.flagged) {
    world.core.moderationActions.push({
      id: row.id,
      actorId: desk.operator,
      action: "remove",
      subjectType: row.subjectType,
      subjectId: mint(world, now),
      subjectOwnerId: row.ownerId,
      reason: row.reason,
      createdAt: ago(now, row.hoursAgo),
    });
  }
}

/**
Runners in every state: banned, leaving, never confirmed.
*/
function accountStates(world: World): void {
  const { now } = world;
  for (const [index, row] of people.banned.entries()) {
    const at = now - (2 + index * 3) * DAY;
    addUser(world, row, 40 + index, true);
    world.core.userProfiles.push({
      userId: row.id,
      username: row.handle,
      bannedAt: at,
      banReason: row.reason,
      onboardingComplete: true,
    });
    world.core.moderationActions.push({
      id: `audit-ban${String(index)}`,
      actorId: desk.operator,
      action: "ban",
      subjectType: "profile",
      subjectId: row.id,
      subjectOwnerId: row.id,
      reason: row.reason,
      createdAt: at,
    });
  }
  for (const [index, row] of people.leaving.entries()) {
    addUser(world, row, 70 + index, true);
    world.core.userProfiles.push({
      userId: row.id,
      username: row.handle,
      onboardingComplete: true,
    });
    world.core.accountDeletions.push({
      userId: row.id,
      requestedAt: now - (1 + index) * DAY,
      purgeAfter: now + (6 - index) * DAY,
    });
  }
  for (const [index, row] of people.unconfirmed.entries()) {
    addUser(world, row, index, false);
    world.core.userProfiles.push({ userId: row.id, username: row.handle });
  }
}

/**
Duplicates: near-miss spellings under one brand, each in some closets.
*/
function duplicates(world: World): void {
  const { now } = world;
  let piece = 0;
  for (const row of desk.dupes) {
    const brandId = mint(world, now - 20 * DAY);
    world.core.brands.push({
      id: brandId,
      name: row.brand,
      normalized: `${row.brand.toLowerCase()} dupes audit`,
    });
    for (const variant of row.variants) {
      const productId = mint(world, now - 20 * DAY);
      world.core.products.push({
        id: productId,
        brandId,
        name: variant.name,
        normalizedName: variant.name.toLowerCase(),
        createdBy: "audit-dupes",
        createdAt: now - 20 * DAY,
      });
      for (let copy = 0; copy < variant.pieces; copy += 1) {
        piece += 1;
        world.core.wardrobeItems.push({
          ...garmentSchema.parse({ category: "top", name: variant.name }),
          id: mint(world, now - 10 * DAY),
          userId: `audit-dupe-${String(piece)}`,
          productId,
          createdAt: now - 10 * DAY,
        });
      }
    }
  }
}

function corrections(world: World): void {
  for (const [index, row] of desk.corrections.entries()) {
    const productId = lookup(world.products, row.product);
    const at = ago(world.now, row.hoursAgo);
    world.core.productCorrections.push({
      id: `audit-c${pad2(index + 1)}`,
      productId,
      userId: row.userId,
      garmentId: resolve(world, row.garment),
      field: row.field,
      value: row.value,
      note: row.note,
      status: "waiting",
      idempotencyKey: mint(world, at),
      createdAt: at,
    });
  }
}

/**
Access: codes, who redeemed them, and the requests waiting.
*/
function accessRows(world: World): void {
  const { now } = world;
  const unconfirmed = new Set(people.unconfirmed.map((row) => row.id));
  const everyone = [
    ...people.runners,
    ...people.banned,
    ...people.leaving,
    ...people.unconfirmed,
  ].map((row) => row.id);
  let redeemer = 0;
  for (const [index, code] of access.codes.entries()) {
    const id = `audit-code${String(index)}`;
    world.core.inviteCodes.push({
      id,
      code: code.code,
      label: code.label,
      maxUses: code.maxUses,
      createdBy: access.operator,
      createdAt: now - (30 - index * 3) * DAY,
      revokedAt: code.revoked ? now - 2 * DAY : undefined,
    });
    for (
      let used = 0;
      used < code.used && redeemer < everyone.length;
      used += 1
    ) {
      const userId = nth(everyone, redeemer);
      redeemer += 1;
      const redeemedAt = now - (20 - used) * DAY;
      world.core.inviteRedemptions.push({
        userId,
        codeId: id,
        email: `${userId}@example.com`,
        heldUntil: now + DAY,
        redeemedAt,
        confirmedAt: unconfirmed.has(userId) ? undefined : redeemedAt + 600,
      });
    }
  }
  for (const [index, row] of access.requests.entries()) {
    world.core.accessRequests.push({
      id: `audit-ask${pad2(index)}`,
      email: row.email,
      note: row.note,
      status: row.status,
      createdAt: now - row.hoursAgo * HOUR,
      updatedAt: now - Math.round(row.hoursAgo / 2) * HOUR,
    });
  }
}

/**
Today on the Desk: jobs that gave up.
*/
function gaveUpRows(world: World): void {
  const { now } = world;
  for (const [index, row] of desk.gaveUp.entries()) {
    world.core.gaveUp.push({
      id: `audit-gave${String(index)}`,
      kind: row.kind,
      subjectId: resolve(world, row.subject),
      reason: row.reason,
      rawError: row.rawError,
      tries: row.tries,
      firstFailedAt: now - (30 + index * 6) * HOUR,
      lastFailedAt: now - (1 + index * 2) * HOUR,
    });
  }
}

function pickFrom<T, V>(
  table: Record<string, T>,
  read: (value: T) => V,
): Record<string, V> {
  return Object.fromEntries(
    Object.entries(table).map(([name, value]) => [name, read(value)]),
  );
}

function summaryOf(world: World): AuditSeed {
  const maya = lookup(world.closets, MAYA_ID);
  const handles = new Map(people.runners.map((row) => [row.id, row.handle]));
  return auditSeedSchema.parse({
    ...pickFrom(summaryPlan.garments, (key) => lookup(maya, key)),
    ...pickFrom(
      summaryPlan.mayaRuns,
      (index) => nth(world.mayaRuns, index).runId,
    ),
    ...pickFrom(summaryPlan.backlogRuns, (index) => nth(world.backlog, index)),
    ...pickFrom(
      summaryPlan.mayaEntries,
      (index) => nth(world.mayaRuns, index).entryId,
    ),
    ...pickFrom(summaryPlan.otherEntries, (ref) =>
      nth(lookup(world.entries, ref.runner), ref.index),
    ),
    ...pickFrom(summaryPlan.handles, (id) => lookup(handles, id)),
  });
}

/**
The PRNG's seed: the date the audit's first capture ran.
*/
const SEED = 20_261_112;

/**
Every row the dense seed writes, for a seed taken at `now` (seconds).
*/
export function buildDenseSeed(now: number): DenseSeed {
  const world: World = {
    now,
    rnd: prng(SEED),
    core: emptyCore(),
    weather: { observations: [], manual: [] },
    objects: [],
    products: new Map(),
    productOrder: [],
    brands: new Map(),
    closets: new Map(),
    entries: new Map(),
    mayaRuns: [],
    backlog: [],
    entryPhotoCount: 0,
    queueIds: [],
  };
  stock(world, MAYA_ID, garmentsData.maya, now - 170 * DAY, 1);
  mayaRuns(world);
  backlogRuns(world);
  for (const [r, runner] of people.runners.entries()) {
    otherRunner(world, runner, r);
  }
  crossFollows(world);
  usefulRows(world);
  // Your conditions: the reading at Maya's place, now.
  observe(world, MAYA, now - HOUR, 3 * HOUR, runsData.rightNow);
  notificationRows(world);
  deskRows(world);
  accountStates(world);
  duplicates(world);
  corrections(world);
  accessRows(world);
  gaveUpRows(world);
  return {
    core: world.core,
    weather: world.weather,
    objects: world.objects,
    summary: summaryOf(world),
    queueIds: world.queueIds,
  };
}
