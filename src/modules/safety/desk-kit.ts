/**
 * A kit as an operator sees it, whatever its audience or state (R-154,
 * #388; design 188): the page Review's other photos and matches, and a
 * removal request's "Open the kit", link to. `/feed/entry/$entryId` asks
 * whether the viewer may see a kit, the question every runner is asked, so a private
 * kit or one hidden pending review sends an operator away; this read asks
 * only whether they are an operator.
 *
 * **Everything on the kit, and nothing the Desk does not need.** Every
 * photo, whatever its screening status, since a copy may be the one held;
 * each is served by `/desk/review-photo/`, which requires an admin too.
 * The garments by name, and the verdict and caption a runner wrote.
 *
 * **The run line (Round 51 · 153, #527):** when and where, because a
 * report is often about both. The start in the run's zone (R-96: its
 * observation's, else the runner's, else UTC), the judged feels-like and
 * the precip class from the run's copy in core (`run_conditions`, D-175),
 * in the operator's own unit, and the runner's city. **The city is a
 * guess (Design 155):** no run stores a place, so the runner's profile
 * city stands in. Not Useful counts or tags: neither decides a report.
 */
import { asc, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { alias } from "drizzle-orm/sqlite-core";

import {
  entryPhotos,
  outfitEntries,
  runConditions,
  runs,
  userProfiles,
} from "../../db/schema-core";
import {
  defaultUnits,
  tempUnitSchema,
  type Audience,
  type TempUnit,
} from "../../lib/contracts";
import type { PrecipClass } from "../../lib/contracts/temperature";
import { isTimeZone } from "../../lib/dates";
import { conditionsForRuns } from "../weather";
import { requireAdmin } from "./admin";
import { kitPiecesSelect } from "./kit-pieces";

type Db = ReturnType<typeof drizzle>;

/**
What the kit's band names: whose it is, who may see it, and where review left it.
*/
export interface DeskKit {
  readonly id: string;
  readonly runnerId: string;
  readonly handle: string | undefined;
  readonly audience: Audience;
  readonly moderationStatus: "ok" | "hidden_pending_review" | "removed";
  readonly verdict: number | undefined;
  readonly caption: string | undefined;
  readonly createdAt: number;
  /**
  The run it was worn on; nothing for a run since deleted.
  */
  readonly run: DeskKitRun | undefined;
  /**
  The runner's city (Design 155's guess: no run stores one).
  */
  readonly city: string | undefined;
  /**
  The operator's own unit, which the run line's temperature is in.
  */
  readonly tempUnit: TempUnit;
  readonly photos: readonly DeskKitPhoto[];
  readonly garments: readonly DeskKitGarment[];
}

/**
 * The run, as the run line says it: when, in which zone, and its
 * conditions when the run has a copy of them.
 */
export interface DeskKitRun {
  readonly startedAt: number;
  readonly timeZone: string | undefined;
  /**
  The feels-like the verdict judged (R-5), in °C.
  */
  readonly feelsLikeC: number | undefined;
  readonly moisture: PrecipClass | undefined;
}

/**
 * One photo on the kit: its id, which the takedown form takes, its key,
 * which `/desk/review-photo/` serves, and how screening left it.
 */
export interface DeskKitPhoto {
  readonly id: string;
  readonly photoKey: string;
  readonly screenStatus: string;
}

/**
A garment worn, by the name its runner gave it.
*/
export interface DeskKitGarment {
  readonly id: string;
  readonly name: string;
  readonly brand: string | undefined;
  readonly category: string;
}

/**
 * The kit, for an operator, or nothing when no kit has that id. Refuses
 * anyone who is not one (`requireAdmin`) before it reads. One batch: the
 * kit with its run, the run's conditions and the runner's profile, its
 * photos in order, its garments in the order they were put on it
 * (`kitPiecesSelect`), and the operator's unit. Then the run's
 * observation, for its zone only.
 */
export async function deskKitFor(
  db: Db,
  viewerId: string,
  entryId: string,
): Promise<DeskKit | undefined> {
  requireAdmin(viewerId);
  const operator = alias(userProfiles, "operator");
  const [kits, photos, garments, units] = await db.batch([
    db
      .select({
        id: outfitEntries.id,
        runnerId: outfitEntries.userId,
        handle: userProfiles.username,
        // fallow-ignore-next-line code-duplication -- fallow 3.34 matches drizzle's select/from/join/where grammar across tables; deskKitFor is the one read of a kit for the Desk, and its pieces already come from kitPiecesSelect, which feed/public-kit.ts shares
        audience: outfitEntries.audience,
        moderationStatus: outfitEntries.moderationStatus,
        verdict: outfitEntries.verdict,
        caption: outfitEntries.caption,
        createdAt: outfitEntries.createdAt,
        // Drizzle answers a left join's object with none of its columns
        // as null: one check for a run since deleted.
        // The run's id from the entry: a second `id` column in one batch
        // row collides with the kit's own.
        runId: outfitEntries.runId,
        run: {
          startedAt: runs.startedAt,
          durationS: runs.durationS,
          lat: runs.lat,
          lng: runs.lng,
        },
        feelsLikeC: runConditions.judgedFeelsLikeC,
        moisture: runConditions.precipClass,
        city: userProfiles.cityLabel,
        runnerZone: userProfiles.timeZone,
        // fallow-ignore-next-line code-duplication -- fallow 3.34 matches drizzle's select/from/join/where grammar across tables; deskKitFor is the one read of a kit for the Desk, and its pieces already come from kitPiecesSelect, which feed/public-kit.ts shares
      })
      .from(outfitEntries)
      .leftJoin(runs, eq(runs.id, outfitEntries.runId))
      .leftJoin(runConditions, eq(runConditions.runId, runs.id))
      .leftJoin(userProfiles, eq(userProfiles.userId, outfitEntries.userId))
      .where(eq(outfitEntries.id, entryId)),
    db
      .select({
        // fallow-ignore-next-line code-duplication -- fallow 3.34 matches drizzle's select/from/join/where grammar across tables; deskKitFor is the one read of a kit for the Desk, and its pieces already come from kitPiecesSelect, which feed/public-kit.ts shares
        id: entryPhotos.id,
        photoKey: entryPhotos.photoKey,
        screenStatus: entryPhotos.screenStatus,
      })
      .from(entryPhotos)
      .where(eq(entryPhotos.entryId, entryId))
      .orderBy(asc(entryPhotos.position)),
    kitPiecesSelect(db, entryId),
    db
      .select({ tempUnit: operator.tempUnit })
      .from(operator)
      .where(eq(operator.userId, viewerId)),
  ]);
  const [kit] = kits;
  if (kit === undefined) return undefined;
  const { runId, feelsLikeC, moisture, city, runnerZone, run, ...rest } = kit;
  const unit = tempUnitSchema.safeParse(units[0]?.tempUnit);
  return {
    ...rest,
    handle: kit.handle ?? undefined,
    verdict: kit.verdict ?? undefined,
    caption: kit.caption ?? undefined,
    run:
      run === null
        ? undefined
        : {
            startedAt: run.startedAt,
            timeZone: await runZone({ ...run, id: runId }, runnerZone),
            feelsLikeC: feelsLikeC ?? undefined,
            moisture: moisture ?? undefined,
          },
    city: city ?? undefined,
    tempUnit: unit.success ? unit.data : defaultUnits.temp,
    photos,
    garments: garments.map(({ id, name, brand, category }) => ({
      id,
      name,
      brand: brand ?? undefined,
      category,
    })),
  };
}

/**
 * The zone the run was in (R-96): its starting observation's, else the
 * runner's own place's, else none, which the formatters read as UTC. A
 * weather read that fails costs the zone only, never the page (law 5).
 */
async function runZone(
  run: Readonly<{
    id: string;
    startedAt: number;
    durationS: number;
    lat: number | null;
    lng: number | null;
  }>,
  runnerZone: string | null,
): Promise<string | undefined> {
  let observed: string | undefined;
  try {
    const found = await conditionsForRuns([run]);
    observed = found.get(run.id)?.timeZone;
  } catch {
    // The zone only: the kit still opens, dated in the runner's zone.
  }
  const zone = observed ?? runnerZone;
  return isTimeZone(zone) ? zone : undefined;
}
