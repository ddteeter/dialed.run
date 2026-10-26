/**
 * The day a run was, as the removal email names it (round 40 C3): "Sat,
 * Aug 29", formatted when the email is owed, so the sender needs no
 * database and an outbox row says the same thing whenever it is sent.
 *
 * **The run's own zone** (R-96), as every run date the app shows: the
 * zone of its starting hour's observation. That lives in `dialed-weather`,
 * which D1 cannot join to `dialed-core`, so it is a second read. A run with
 * no observation — indoors, a band, or a cache that never resolved — is
 * dated in UTC, as `proseDayLabel` dates anything without a zone.
 *
 * **Degrade, don't fail** (law 5): the date is a courtesy in a removal's
 * email, so a weather read that fails is reported and the day falls back
 * to UTC. A removal never fails over it.
 */
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { runs } from "../../db/schema-core";
import { proseDayLabel } from "../../lib/dates";
import { firstRowWhere } from "../../lib/sql/keyed-read";

import { observationsForRuns } from "./conditions";
import type { Report } from "./retract";

type Run = Parameters<typeof observationsForRuns>[0][number];

/**
 * The run's day, or nothing for a run that is not there — whose email
 * then says "one of your runs", as one owed before this did.
 */
export async function runDayOf(
  db: DrizzleD1Database,
  runId: string,
  report: Report,
): Promise<string | undefined> {
  // A primary-key read; `observationsForRuns` takes the run row as it is.
  const run = await firstRowWhere(db, runs, eq(runs.id, runId));
  if (run === undefined) return undefined;
  return proseDayLabel(run.startedAt, await zoneOf(run, report));
}

/**
The zone of the run's starting hour, or none: no observation, or no answer.
*/
async function zoneOf(run: Run, report: Report): Promise<string | undefined> {
  try {
    const conditions = await observationsForRuns([run]);
    return conditions.get(run.id)?.timeZone;
  } catch (error) {
    report(error, { surface: "removal-run-day", runId: run.id });
    return undefined;
  }
}
