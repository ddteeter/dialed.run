/**
 * The runner's time zone (design 142): cached on the profile, derived from
 * the home place and never typed by the runner.
 *
 * Three parts, all here:
 *
 * - `fillZoneInBackground`, which the place writer (`./profile.ts`) calls
 *   after it has saved a place, so the runner never waits on the lookup;
 * - `fillMissingTimeZones`, the hourly re-drive for a lookup that failed
 *   or never ran;
 * - `runnerTimeZone`, the one read.
 *
 * The lookup itself is `modules/weather`'s `timeZoneAt`, handed in as
 * `ZoneDeps` the way `./place.ts` takes its resolver, so these decisions
 * are testable without the network.
 */
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { runs, userProfiles } from "../../db/schema-core";
import { ulidSchema } from "../../lib/ids";
import { observationsForRuns } from "../weather";

/**
 * What `zoneForPlace` needs: `modules/weather`'s `timeZoneAt`, and where a
 * failed lookup is reported (`ops`'s `captureException`).
 */
export interface ZoneDeps {
  readonly zoneAt: (lat: number, lng: number) => Promise<string | undefined>;
  readonly report: (error: unknown, context: Record<string, string>) => void;
}

/**
 * What the place writer needs on top of the lookup: `keepAlive`, which
 * keeps the Worker running past the response while the lookup finishes
 * (`waitUntil`, from `src/env`).
 */
export interface SaveZoneDeps extends ZoneDeps {
  readonly keepAlive: (work: Promise<unknown>) => void;
}

/**
 * The zone of a place, or `undefined` when there is none to have.
 *
 * Nothing is asked for a place without both coordinates: the zone is a
 * fact about where it is, and a place without coordinates has no where.
 *
 * **Degrade, don't fail** (law 5). A lookup that throws is reported, with
 * the user id and never the place, and answers `undefined`, so the place
 * is still saved. A NULL zone beside coordinates is the marker
 * `fillMissingTimeZones` re-drives. A provider that answers with no zone is
 * reported the same way (law 6), because the marker would otherwise be
 * re-driven forever in silence.
 */
async function zoneForPlace(
  place: Readonly<{
    lat?: number | null | undefined;
    lng?: number | null | undefined;
  }>,
  deps: ZoneDeps,
  userId: string,
): Promise<string | undefined> {
  const { lat, lng } = place;
  if (typeof lat !== "number" || typeof lng !== "number") return undefined;
  try {
    const zone = await deps.zoneAt(lat, lng);
    if (zone === undefined) {
      // Law 6: a place the provider cannot name a zone for is asked again
      // every firing until someone knows, so it must be seen.
      deps.report(new Error("Provider named no time zone for the place"), {
        surface: "onboarding.fillMissingTimeZones",
        userId,
      });
    }
    return zone;
  } catch (error: unknown) {
    deps.report(error, { surface: "onboarding.fillMissingTimeZones", userId });
    return undefined;
  }
}

/**
 * After a place is saved: look its zone up without making the runner wait
 * for it, and write it with the same compare-and-set the hourly fill uses.
 *
 * The save has already stored the place with a NULL zone, and that marker
 * is what makes this safe to lose: a Worker that dies before the lookup
 * lands leaves a row the next `fillMissingTimeZones` firing picks up. A
 * place without both coordinates has no zone to look for.
 *
 * Never rejects (law 5): a failed write is reported, and the marker stays.
 */
export function fillZoneInBackground(
  db: DrizzleD1Database,
  userId: string,
  place: Readonly<{
    lat?: number | null | undefined;
    lng?: number | null | undefined;
  }>,
  deps: SaveZoneDeps,
): void {
  const { lat, lng } = place;
  if (typeof lat !== "number" || typeof lng !== "number") return;
  deps.keepAlive(
    (async () => {
      try {
        await fillOne(db, { userId, lat, lng }, deps);
      } catch (error: unknown) {
        deps.report(error, {
          surface: "onboarding.fillMissingTimeZones",
          userId,
        });
      }
    })(),
  );
}

/**
 * Rows looked up per firing. The lookups run in parallel, so a provider
 * outage costs the firing one timeout rather than ten, and the batch
 * bounds what a firing can spend upstream.
 */
const FILL_BATCH = 10;

/**
 * The re-drive (law 8c, reconciliation): profiles with coordinates and no
 * zone, looked up again. Rides the hourly `weather-retry` firing.
 *
 * **Compare-and-set, not a claim.** Each write lands only while the row
 * still holds the coordinates that were looked up and still has no zone.
 * A runner who saved a new place mid-lookup keeps the new place's zone
 * (or its marker), and two overlapping firings write once. The worst an
 * overlap costs is one extra lookup.
 *
 * One statement per row rather than one batch: each runner's zone is
 * independent of every other's, and a write that fails leaves only its
 * own row NULL for the next firing.
 *
 * `user_profiles_zone_owed`, a partial index on exactly these rows, serves
 * the filter, so the hourly read costs the rows owed and not the table.
 */
export async function fillMissingTimeZones(
  db: DrizzleD1Database,
  deps: ZoneDeps,
): Promise<void> {
  const owed = await db
    .select({
      userId: userProfiles.userId,
      lat: userProfiles.lat,
      lng: userProfiles.lng,
    })
    .from(userProfiles)
    .where(
      and(
        isNull(userProfiles.timeZone),
        isNotNull(userProfiles.lat),
        isNotNull(userProfiles.lng),
      ),
    )
    // Random, so rows whose lookup never succeeds cannot hold the batch:
    // without an order the same ten came back every hour and the rest of
    // the owed rows were never reached. The owed set is small (design 142).
    .orderBy(sql`random()`)
    .limit(FILL_BATCH);
  await Promise.all(owed.map((row) => fillOne(db, row, deps)));
}

async function fillOne(
  db: DrizzleD1Database,
  row: Readonly<{ userId: string; lat: number | null; lng: number | null }>,
  deps: ZoneDeps,
): Promise<void> {
  const zone = await zoneForPlace(row, deps, row.userId);
  if (zone === undefined) return;
  await db
    .update(userProfiles)
    .set({ timeZone: zone })
    .where(
      and(
        eq(userProfiles.userId, row.userId),
        // `IS`, SQLite's equality that a NULL cannot slip through, because
        // drizzle's `eq` will not take the nullable value the row is typed
        // as. The filter above means it is never NULL here.
        sql`${userProfiles.lat} IS ${row.lat}`,
        sql`${userProfiles.lng} IS ${row.lng}`,
        isNull(userProfiles.timeZone),
      ),
    );
}

/**
 * How many of the runner's newest located runs are asked for a zone. A
 * run's zone comes from its observation, which a run whose weather never
 * arrived lacks, so one run is not always enough.
 */
const ZONE_RUNS = 5;

/**
 * The runner's time zone, for their day and their clock: the profile's
 * zone, else the zone of their latest located run whose observation named
 * one, else UTC. Always an IANA name `Intl` accepts.
 *
 * The profile's zone is read first and is the only read for a runner who
 * has one. The run fallback covers a runner with no place saved, or one
 * whose lookup has not succeeded yet.
 */
export async function runnerTimeZone(
  db: DrizzleD1Database,
  userId: string,
): Promise<string> {
  const profiles = await db
    .select({ timeZone: userProfiles.timeZone })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  const cached = profiles.at(0)?.timeZone;
  if (cached !== null && cached !== undefined) return cached;

  // The run fallback: two databases, so assembled in code. The runs are
  // core's and the zones are the weather cache's (CLAUDE.md's one exception
  // to filtering in SQL). On `runs_user_started`.
  const located = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.userId, userId), isNotNull(runs.lat)))
    .orderBy(desc(runs.startedAt))
    .limit(ZONE_RUNS);
  const ids = located.map((run) => ulidSchema.parse(run.id));
  const observed = await observationsForRuns(ids);
  const fromRuns = ids
    .map((id) => observed.get(id)?.timeZone)
    .find((zone) => zone !== undefined);
  return fromRuns ?? "UTC";
}
