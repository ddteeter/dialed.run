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
import { eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { gaveUpClearPrefix } from "../../ops/gave-up";
import { stravaConnections, stravaRevocations } from "../../../db/schema-core";
import { guarded, runGuarded } from "../../../lib/sql/batch-guard";
import { firstRowWhere } from "../../../lib/sql/keyed-read";
import { newUlid } from "../../../lib/ids";
import { nowSeconds } from "../../../lib/now";
import { STRAVA_DISCONNECTED_LINE } from "../../../lib/contracts/email";
import type { OutboxMessage } from "../../../lib/sql/outbox";
import { emailDebt } from "../../email";
import { notificationInsert } from "../../notifications";
import type { CoreDb } from "../core-db";
import { reminderSubjectPrefix } from "../queue-messages";

/**
 * What S1 says when a deauthorization arrives. Strava's word for what
 * happened rather than the runner's, since this app cannot tell a runner
 * who disconnected on Strava from an event someone else sent. The
 * `strava_broken` kind, because it is the kind that means "your Strava
 * connection is no longer working" — nothing else writes it now that the
 * refresh path is gone.
 */
export const STRAVA_REVOKED_BODY = STRAVA_DISCONNECTED_LINE;

/**
 * The "Strava disconnected" account mail (D-43, round 27 #19): the one
 * email both ways of disconnecting send — this event, and the runner's
 * own disconnect in the app (`oauth.ts`'s `disconnectStravaAndTell`,
 * legal-readiness C3). Keyed by the runner and the moment of the
 * disconnect, so a repeat of the same one owes the same outbox row.
 */
export function disconnectedEmail(userId: string, at: number): OutboxMessage {
  return emailDebt(
    { to: { userId }, template: { kind: "strava_disconnected" } },
    { dedupeKey: `strava_disconnected:${userId}:${String(at)}` },
  );
}

/**
 * An outbox row owed, as a statement for the caller's batch — ops'
 * `outboxInsert(db, oweOutbox(message, notBefore))`, handed in by the
 * queue entry: `ops` imports this module for its consumer, so this module
 * cannot import `ops`. `notBefore` holds the row back to a date, as a
 * failed import's file is (epoch seconds).
 */
export type Owe = (
  message: OutboxMessage,
  notBefore?: number,
) => BatchItem<"sqlite">;

/**
 * Delete the connection for this athlete, owe Strava the revoke, and tell
 * its runner — together, in the app and by email (round 27 #19's "Email
 * Strava disconnected", through task 126's interface).
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
 * that Strava is owed a call, so neither may miss the delete. The Desk's
 * Gave up rows for the athlete's reminders go in it too (R-142): a delete
 * plus whatever cleans up after it.
 *
 * An athlete nobody here has connected is acknowledged and ignored.
 */
export async function deauthorizeAthlete(
  db: CoreDb,
  athleteId: string,
  eventTime: number,
  owe: Owe,
): Promise<void> {
  const { connectedAt } = stravaConnections;
  const aboutThisGrant = sql`${eq(stravaConnections.athleteId, athleteId)} and (${connectedAt} is null or ${connectedAt} <= ${eventTime})`;
  const connection = await firstRowWhere(db, stravaConnections, aboutThisGrant);
  if (connection === undefined) return;

  // Keyed by the event, as the notification is, so a redelivery owes the
  // same row.
  const told = disconnectedEmail(connection.userId, eventTime);
  // The revocation is of the row the delete removes, read as the batch
  // runs, and the delete is guarded (#1094): a runner who reconnected
  // since the read has a connection this event is not about, so the
  // delete misses and nothing else lands, neither the "disconnected"
  // notice nor a revocation of a token Strava may have handed back again.
  await runGuarded(db, [
    revocationOf(db, newUlid(), nowSeconds(), aboutThisGrant),
    ...guarded(
      db,
      db.delete(stravaConnections).where(aboutThisGrant),
      "deauthorized-grant",
    ),
    notificationInsert(db, {
      userId: connection.userId,
      kind: "strava_broken",
      subjectId: String(eventTime),
      body: STRAVA_REVOKED_BODY,
    }),
    owe(told),
    // A dead-lettered reminder's Gave up row holds this athlete's Strava
    // ids (R-142), and they go with the grant.
    gaveUpClearPrefix(db, "reminder", reminderSubjectPrefix(athleteId)),
  ]);
}

/**
 * A revocation of the grant in each connection row `which` picks, when
 * the statement runs: `INSERT … SELECT` from the row itself, placed ahead
 * of the write that deletes or replaces it in the same batch, so what is
 * revoked is exactly what that write removes. Nothing, when no row
 * matches.
 */
export function revocationOf(
  db: CoreDb,
  id: string,
  createdAt: number,
  which: SQL,
) {
  // In the table's column order, which is the order drizzle names them in.
  const revoked = db
    .select({
      id: sql<string>`${id}`.as(stravaRevocations.id.name),
      createdAt: sql<number>`${createdAt}`.as(stravaRevocations.createdAt.name),
      refreshToken: stravaConnections.refreshToken,
    })
    .from(stravaConnections)
    .where(which);
  return db.insert(stravaRevocations).select(revoked);
}
