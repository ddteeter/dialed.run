/**
 * A runner revoking dialed.run on Strava's own side (STR-3, finding 0.2).
 *
 * Strava's API Policy §7.4 requires a revoked grant's data to be deleted
 * "within thirty (30) days". What we hold is the connection row — the
 * athlete id and both tokens — and this deletes it the moment the event is
 * consumed, which is well inside that.
 *
 * Nothing is owed back to Strava: the athlete already revoked us, so no
 * `strava_revocations` row is written.
 */
import { eq } from "drizzle-orm";

import { stravaConnections } from "../../../db/schema-core";
import { firstColumnWhere } from "../../../lib/keyed-read";
import { notificationInsert } from "../../notifications";
import type { CoreDb } from "../core-db";

/**
 * What S1 says when the connection went away on Strava's side. The
 * `strava_broken` kind, because it is the kind that means "your Strava
 * connection is no longer working" — nothing else writes it now that the
 * refresh path is gone.
 */
export const STRAVA_REVOKED_BODY =
  "You disconnected dialed.run on Strava, so run reminders have stopped.";

/**
 * Delete the connection for this athlete and tell its runner, together.
 *
 * **Idempotent twice over** (law 1). A redelivery finds no connection and
 * stops; and if two deliveries race past that read, the notification's
 * subject is the event time, so UNIQUE(user, kind, subject) makes the
 * second insert nothing and the second delete deletes nothing. The event
 * time rather than the athlete id, because a runner who reconnects and
 * revokes again is a second event and deserves a second row.
 *
 * One batch (CLAUDE.md, D1 discipline): the row is the only record the
 * runner gets that reminders stopped, so it must not be possible for the
 * delete to land without it.
 *
 * An athlete nobody here has connected is acknowledged and ignored.
 */
export async function deauthorizeAthlete(
  db: CoreDb,
  athleteId: string,
  eventTime: number,
): Promise<void> {
  const userId = await firstColumnWhere(
    db,
    stravaConnections,
    stravaConnections.userId,
    eq(stravaConnections.athleteId, athleteId),
  );
  if (userId === undefined) return;

  await db.batch([
    db
      .delete(stravaConnections)
      .where(eq(stravaConnections.athleteId, athleteId)),
    notificationInsert(db, {
      userId,
      kind: "strava_broken",
      subjectId: String(eventTime),
      body: STRAVA_REVOKED_BODY,
    }),
  ]);
  // The call site for the "Strava revoked" transactional email (decision
  // D-43), which lands here, after the batch, once task 126 publishes
  // `modules/email` (ACC-2). Never the binding directly.
}
