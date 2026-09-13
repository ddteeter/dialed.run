import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";
import type { ClimateNormals } from "../../lib/contracts";
import { TAP_LIST_FOLD, tapListFor } from "../closet";
import type { TapListEntry } from "../closet";
import { BAND_WITHOUT_LOCATION, resolveClimateBand } from "./climate";

export interface StarterList {
  /**
  The whole table, in this runner's band order. Never a subset.
  */
  entries: readonly TapListEntry[];
  /**
  How many rows O3 shows before the disclosure.
  */
  fold: number;
}

/**
 * What O3 is handed: one list, ordered for where this runner runs.
 *
 * **The band never removes a row** (design round 6 §AA), so everything
 * this decides is *position*. That is what makes the climate lookup worth
 * doing and also what makes it safe to get wrong: a bad band costs a
 * scroll, where a bad filter would cost the garment.
 *
 * The ordering happens here, server-side, rather than in the component,
 * because `tapListFor` lives behind `modules/closet`'s barrel — and that
 * barrel re-exports the service, which pulls `db/schema`. A route or
 * component importing it ships drizzle to the browser and fails nothing
 * (CLAUDE.md's client-bundle rule, twice measured). So the list crosses
 * the wire already sorted.
 *
 * `normalsFor` is a parameter rather than an import so a test can run this
 * without a provider, and so the degrade path is reachable by making it
 * reject — which is `resolveClimateBand`'s whole contract.
 */
export async function starterList(
  db: DrizzleD1Database,
  userId: string,
  normalsFor: (lat: number, lng: number) => Promise<ClimateNormals>,
): Promise<StarterList> {
  const band = await bandFor(db, userId, normalsFor);
  return { entries: tapListFor(band), fold: TAP_LIST_FOLD };
}

/**
 * A runner with no coordinates gets the mild ordering, and never a lookup.
 *
 * O1's location step is refusable, so "no lat/lng" is an ordinary outcome
 * rather than an error — the typed city is a label with nothing behind it.
 * Asking the provider about `null` would be a wasted record and a failure
 * to catch.
 */
async function bandFor(
  db: DrizzleD1Database,
  userId: string,
  normalsFor: (lat: number, lng: number) => Promise<ClimateNormals>,
) {
  // A generic `firstRowWhere(db, table, columns, where)` in `lib/keyed-read`
  // is the obvious extraction and it does not typecheck. Drizzle infers the
  // row type for a *literal* column map and stops for a generic one: with
  // `TColumns extends Record<string, SQLiteColumn>` the `select().from()
  // .where()` chain widens to a union that includes the query builder
  // itself, so the awaited value is neither iterable nor indexable. Tried
  // four ways — annotating the result, `.all()`, `.execute()`, making the
  // table generic too. Same class of failure CLAUDE.md already records for
  // wrapping `createServerFn`: the concrete version compiles and the
  // generic one cannot.
  //
  // fallow-ignore-next-line code-duplication -- the query is the same read as feed/units.ts's, and the extraction that would merge them does not typecheck (see above); what differs after it is the part that matters, since "no location" and "no unit preference" are different facts with different right answers
  const [row] = await db
    .select({ lat: userProfiles.lat, lng: userProfiles.lng })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  if (row === undefined) return BAND_WITHOUT_LOCATION;
  // `typeof`, not a comparison against `null`: both columns are nullable
  // `real`s, so each arrives as `number | null`, and `unicorn/no-null`
  // rules out writing the literal. Asking whether it *is* a number narrows
  // it and reads as the question being asked — "do we have a coordinate" —
  // rather than as a list of the ways we might not.
  //
  // Both halves are checked because `calibrationInput` takes `lat` and
  // `lng` independently, so a row with one and not the other is
  // expressible, and half a coordinate is not a place.
  const { lat, lng } = row;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return BAND_WITHOUT_LOCATION;
  }
  return resolveClimateBand(lat, lng, normalsFor);
}
