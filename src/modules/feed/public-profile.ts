/**
 * A public profile, read for the open web (round 41 #86d, D-151): what
 * `/@handle` shows to anyone, signed in or not.
 *
 * **Two gates, neither with a viewer.** The runner: the handle's current
 * holder, with "Public profile" on and in standing — not banned, not
 * leaving, address confirmed (`runnerInStanding`, the floor H and search
 * stand on). The kits: through `worldVisibleEntry()` alone, the one
 * open-web rule. Every other reason a profile is not public — the switch
 * off, a ban, a leaving, a handle given up or never held — is the same
 * `undefined`, so the page cannot tell them apart (#86f).
 *
 * **An explicit pick.** Each kit row is built field by field into
 * `PublicKitRow`, with step 6's own helpers (the day, the conditions, the
 * verdict), and the rotation is the closet's own (`publicRotation`): names,
 * types and shoe mileage. The runner's id leaves beside the profile, for
 * the cache tags only, and never reaches the page.
 */
import { and, desc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { outfitEntries, runs, userProfiles } from "../../db/schema-core";
import { coreDb } from "../../env";
import type { Units } from "../../lib/contracts";
import { handleCacheTag } from "../../lib/cache-tags";
import { usernameSchema } from "../../lib/contracts/garments";
import { distanceNumber } from "../../lib/contracts/measures";
import { firstRowWhere } from "../../lib/sql/keyed-read";
import { lookUpHandle } from "../account";
import { publicRotation } from "../closet";
import { firstPublishedPhotos, publicPageHeaders } from "../ops";
import { worldVisibleEntry } from "../safety";

import { observationsForRuns, type Conditions } from "./conditions";
import { countWhere } from "./count-where";
import { conditionsOf, runDayOf, verdictOf } from "./public-kit";
import {
  FIRST_KITS,
  type PublicKitRow,
  type PublicProfile,
} from "./public-profile-shape";
import { runnerInStanding } from "./runner-visibility";
import { unitsFor } from "./units";

type Database = DrizzleD1Database;

/**
 * The most kits "Show {N} more" lists. A bound on what one view reads, not
 * a page size: past it the page shows the newest hundred, and the count
 * still says how many there are.
 */
const ALL_KITS = 100;

/**
 * The profile and the runner whose it is, or nothing: not public, for
 * every reason alike.
 */
export interface PublicProfileRead {
  readonly profile: PublicProfile;
  readonly runnerId: string;
}

export async function publicProfileRead(
  handle: string,
  isAll: boolean,
): Promise<PublicProfileRead | undefined> {
  const database = coreDb();
  const found = await lookUpHandle(database, handle);
  if (found?.kind !== "current") return undefined;
  const runner = await firstRowWhere(
    database,
    userProfiles,
    and(
      eq(userProfiles.userId, found.userId),
      eq(userProfiles.publicProfile, true),
      runnerInStanding(),
    ),
  );
  // A handle is how the page names its runner; the lookup found the
  // runner by it, so a row without one is a runner who gave it up since.
  if (typeof runner?.username !== "string") return undefined;
  const units = await unitsFor(database, runner.userId);
  const [kitCount, kits, rotation] = await Promise.all([
    countWhere(database, outfitEntries, kitsOf(runner.userId)),
    kitRowsOf(database, runner.userId, isAll ? ALL_KITS : FIRST_KITS),
    runner.publicCloset
      ? publicRotation(database, runner.userId, units.distance)
      : Promise.resolve(undefined),
  ]);
  return {
    profile: {
      handle: runner.username,
      kitCount,
      kits: await shapedRows(database, kits, runner.timeZone, units),
      ...(rotation !== undefined && { rotation }),
    },
    runnerId: runner.userId,
  };
}

/**
 * The runner's PUBLIC kits, by the open web's one rule: what
 * `entries_user_world_created` is partial on, so the count and the list
 * are index seeks.
 */
function kitsOf(userId: string) {
  return and(eq(outfitEntries.userId, userId), worldVisibleEntry());
}

/**
 * The newest `limit` public kits with what their rows show, and the run's
 * place and span only to find its observation (never returned).
 */
async function kitRowsOf(database: Database, userId: string, limit: number) {
  return database
    .select({
      entryId: outfitEntries.id,
      verdict: outfitEntries.verdict,
      run: {
        id: runs.id,
        startedAt: runs.startedAt,
        durationS: runs.durationS,
        distanceM: runs.distanceM,
        lat: runs.lat,
        lng: runs.lng,
      },
    })
    .from(outfitEntries)
    .innerJoin(runs, eq(runs.id, outfitEntries.runId))
    .where(kitsOf(userId))
    .orderBy(desc(outfitEntries.createdAt))
    .limit(limit);
}

type KitRow = Awaited<ReturnType<typeof kitRowsOf>>[number];

/**
 * Each row as #86d draws it, with the kit's first photo as `/k` reads it.
 * The observations are read in one batch from the weather database, which
 * D1 cannot join to the core one (8c), so the pairing happens here.
 */
async function shapedRows(
  database: Database,
  rows: readonly KitRow[],
  runnerZone: string | null,
  units: Units,
): Promise<PublicKitRow[]> {
  const [observed, photos] = await Promise.all([
    observationsForRuns(rows.map((row) => row.run)),
    firstPublishedPhotos(
      database,
      rows.map((row) => row.entryId),
    ),
  ]);
  return rows.map((row) =>
    shapedRow(
      row,
      { conditions: observed.get(row.run.id), photo: photos.get(row.entryId) },
      runnerZone,
      units,
    ),
  );
}

/**
What a row shows that was read beside it.
*/
interface ReadBeside {
  readonly conditions: Conditions | undefined;
  readonly photo: string | undefined;
}

function shapedRow(
  row: KitRow,
  { conditions, photo }: ReadBeside,
  runnerZone: string | null,
  units: Units,
): PublicKitRow {
  const verdict = verdictOf(row.verdict);
  return {
    entryId: row.entryId,
    ...(photo !== undefined && { photo }),
    day: runDayOf(row.run.startedAt, conditions, runnerZone),
    ...conditionsOf(conditions, row.verdict, units),
    ...(verdict !== undefined && { verdict }),
    distance: {
      value: distanceNumber(row.run.distanceM, units.distance),
      unit: units.distance,
    },
  };
}

/**
 * The page's cache headers: tagged with the handle's path always (so a
 * purge on publish can clear the not-public page cached there), and the
 * runner when the profile is public. A segment that is not a handle names
 * nothing a purge could.
 */
export function publicProfileHeaders(
  handle: string,
  read: PublicProfileRead | undefined,
): Record<string, string> {
  const parsed = usernameSchema.safeParse(handle);
  return publicPageHeaders(
    parsed.success ? handleCacheTag(parsed.data) : undefined,
    read?.runnerId,
  );
}

/**
 * The page's read, for its server function: the profile or nothing, with
 * the headers the page must leave with handed to `setHeaders` (the
 * framework's `setResponseHeaders`, passed in so this stays testable).
 */
export async function publicProfileForPage(
  handle: string,
  isAll: boolean,
  setHeaders: (headers: Record<string, string>) => void,
): Promise<PublicProfile | undefined> {
  const read = await publicProfileRead(handle, isAll);
  setHeaders(publicProfileHeaders(handle, read));
  return read?.profile;
}
