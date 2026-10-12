import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { gaveUpUpsert } from "../src/db/gave-up";
import { gaveUp } from "../src/db/schema-core";
import { env } from "../src/env";
import type { GaveUpKind } from "../src/lib/contracts/gave-up";
import { reminderSubject } from "../src/modules/runs/queue-messages";

/**
 * The Desk's Gave up row for one job, as the table holds it, or undefined
 * — for the writers' tests, which assert that a job landed there (R-119).
 */
export async function gaveUpRow(kind: GaveUpKind, subjectId: string) {
  const [row] = await drizzle(env.DIALED_CORE)
    .select()
    .from(gaveUp)
    .where(and(eq(gaveUp.kind, kind), eq(gaveUp.subjectId, subjectId)));
  return row;
}

const FAILED = { reason: "Gave up.", tries: 3 } as const;

function reminderOf(athleteId: string): string {
  return reminderSubject({
    type: "strava_reminder",
    athleteId,
    objectId: "9",
    aspectType: "create",
    eventTime: 1_700_000_000,
  });
}

/**
 * Gave up rows around one Strava athlete (R-142): a dead-lettered reminder
 * of theirs, one of an athlete whose id starts with theirs, and a row of
 * another kind whose subject happens to start the same way. A disconnect
 * or a purge takes the first and leaves the other two.
 */
export async function seedAthleteGaveUp(athleteId: string) {
  const theirs = reminderOf(athleteId);
  const neighbour = reminderOf(`${athleteId}0`);
  const db = drizzle(env.DIALED_CORE);
  await db.batch([
    gaveUpUpsert(db, { kind: "reminder", subjectId: theirs, ...FAILED }),
    gaveUpUpsert(db, { kind: "reminder", subjectId: neighbour, ...FAILED }),
    gaveUpUpsert(db, { kind: "import", subjectId: theirs, ...FAILED }),
  ]);
  /**
  Which of the three are still there.
  */
  return async () => ({
    theirs: (await gaveUpRow("reminder", theirs)) !== undefined,
    neighbour: (await gaveUpRow("reminder", neighbour)) !== undefined,
    otherKind: (await gaveUpRow("import", theirs)) !== undefined,
  });
}

/**
What `seedAthleteGaveUp` leaves once the athlete's own rows are gone.
*/
export const ONLY_THEIRS_GONE = {
  theirs: false,
  neighbour: true,
  otherKind: true,
} as const;
