/**
 * A runner revoking dialed.run on Strava's own side (STR-3, finding 0.2).
 *
 * Strava's API Policy §7.4 requires a revoked grant's data to be deleted
 * "within thirty (30) days". What we hold is the connection row — the
 * athlete id and the refresh token — and this deletes it the moment the event is
 * consumed, which is well inside that.
 *
 * **It also owes Strava a revoke, because the event may be forged.** A
 * push subscription id is not a secret and athlete ids are public, so
 * anyone could post a deauthorization for a runner. Deleting their row and
 * nothing else would leave their grant live on Strava with nothing here
 * able to revoke it. So the delete writes a `strava_revocations` row with
 * the refresh token, in the same batch, exactly as a disconnect does:
 * `/oauth/revoke` answers 200 "whether or not the token was found", so
 * for a genuine deauthorization the revoke is a harmless no-op, and for a
 * forged one it closes the grant. The daily digest drains it.
 */
import { and, eq, isNull, lte, or } from "drizzle-orm";

import { stravaConnections, stravaRevocations } from "../../../db/schema-core";
import { firstRowWhere } from "../../../lib/keyed-read";
import { newUlid } from "../../../lib/ids";
import { nowSeconds } from "../../../lib/now";
import { notificationInsert } from "../../notifications";
import type { CoreDb } from "../core-db";

/**
 * What S1 says when a deauthorization arrives. Strava's word for what
 * happened rather than the runner's, since this app cannot tell a runner
 * who disconnected on Strava from an event someone else sent. The
 * `strava_broken` kind, because it is the kind that means "your Strava
 * connection is no longer working" — nothing else writes it now that the
 * refresh path is gone.
 */
export const STRAVA_REVOKED_BODY =
  "Strava says dialed.run was disconnected, so run reminders have stopped.";

/**
 * Delete the connection for this athlete, owe Strava the revoke, and tell
 * its runner — together.
 *
 * **Only a grant the event can be about.** An event older than the
 * connection is about an earlier grant — a redelivery that arrives after
 * the runner reconnected — and must not delete the new one. A row made
 * before `connected_at` existed has none, and an event may delete it.
 *
 * **Idempotent** (law 1). A redelivery finds no connection and stops; and
 * if two deliveries race past that read, the notification's subject is
 * the event time, so UNIQUE(user, kind, subject) makes the second insert
 * nothing and the second delete deletes nothing. The revocation row is
 * written by both, and revoking a token twice is the same as once.
 *
 * One batch (CLAUDE.md, D1 discipline): the row is the only record the
 * runner gets that reminders stopped, and the revocation the only record
 * that Strava is owed a call, so neither may miss the delete.
 *
 * An athlete nobody here has connected is acknowledged and ignored.
 */
export async function deauthorizeAthlete(
  db: CoreDb,
  athleteId: string,
  eventTime: number,
): Promise<void> {
  const aboutThisGrant = and(
    eq(stravaConnections.athleteId, athleteId),
    or(
      isNull(stravaConnections.connectedAt),
      lte(stravaConnections.connectedAt, eventTime),
    ),
  );
  const connection = await firstRowWhere(db, stravaConnections, aboutThisGrant);
  if (connection === undefined) return;

  await db.batch([
    db.delete(stravaConnections).where(aboutThisGrant),
    db.insert(stravaRevocations).values({
      id: newUlid(),
      refreshToken: connection.refreshToken,
      createdAt: nowSeconds(),
    }),
    notificationInsert(db, {
      userId: connection.userId,
      kind: "strava_broken",
      subjectId: String(eventTime),
      body: STRAVA_REVOKED_BODY,
    }),
  ]);
  // The call site for the "Strava revoked" transactional email (decision
  // D-43), which lands here, after the batch, once task 126 publishes
  // `modules/email` (ACC-2). Never the binding directly.
}
